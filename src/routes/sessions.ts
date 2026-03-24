import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { getProject } from '../models/project.js';
import { createSession, getSession, listSessionsByProject, transitionState } from '../models/session.js';
import { buildCommand, type SessionType, type SandboxCommand } from '../services/sandbox.js';
import { ensureAgentFramework } from '../services/agent-framework.js';
import { spawnProcess, killProcess, startTaskLoop } from '../services/process-manager.js';
import { registerProcess, unregisterProcess, getActiveProcess } from '../services/process-registry.js';
import { createSessionLogger, readLog } from '../services/session-logger.js';
import { parseTaskSummary } from '../services/task-parser.js';
import { broadcastSessionState, broadcastSSHAgentRequest } from '../ws/session-stream.js';
import { broadcastProjectUpdate } from '../ws/dashboard.js';
import { detectSSHRemote, createBridge, type SSHAgentBridge } from '../services/ssh-agent-bridge.js';
import type { PushService } from '../services/push.js';

const DEFAULT_TASK_RUN_PROMPT = 'Read the task list, find the next unchecked task, implement it, verify it passes, mark it complete, and commit.';

const log = createLogger('sessions');

/** Active SSH agent bridges keyed by session ID. */
const activeBridges = new Map<string, SSHAgentBridge>();

/** Get the active SSH agent bridge for a session (used by WebSocket message handlers). */
export function getActiveBridge(sessionId: string): SSHAgentBridge | undefined {
  return activeBridges.get(sessionId);
}

/**
 * Create an SSH agent bridge for a session if the project has an SSH remote.
 * Returns the socket path if bridge was created, undefined otherwise.
 */
export async function setupBridge(sessionId: string, projectDir: string, dataDir: string): Promise<string | undefined> {
  const remote = detectSSHRemote(projectDir);
  if (!remote) return undefined;

  const socketPath = join(dataDir, 'sessions', sessionId, 'agent.sock');
  try {
    const bridge = await createBridge({
      sessionId,
      socketPath,
      remoteContext: remote,
      onRequest: (request) => {
        broadcastSSHAgentRequest(sessionId, request);
      },
    });
    activeBridges.set(sessionId, bridge);
    log.info({ sessionId, socketPath, remote }, 'SSH agent bridge created');
    return socketPath;
  } catch (err) {
    log.warn({ sessionId, err }, 'Failed to create SSH agent bridge');
    return undefined;
  }
}

/** Destroy and remove the SSH agent bridge for a session. */
export async function cleanupBridge(sessionId: string): Promise<void> {
  const bridge = activeBridges.get(sessionId);
  if (bridge) {
    activeBridges.delete(sessionId);
    try {
      await bridge.destroy();
    } catch (err) {
      log.warn({ sessionId, err }, 'Error destroying SSH agent bridge');
    }
  }
}

/**
 * Inject SSH_AUTH_SOCK into a SandboxCommand. For sandboxed processes,
 * also adds --setenv and BindPaths so the socket is accessible inside the sandbox.
 */
export function injectSSHAuthSock(sandboxCmd: SandboxCommand, socketPath: string): void {
  sandboxCmd.env = { ...sandboxCmd.env, SSH_AUTH_SOCK: socketPath };

  if (!sandboxCmd.unsandboxed) {
    // Find where systemd-run flags end (the 'nix' command)
    const nixIdx = sandboxCmd.args.indexOf('nix');
    if (nixIdx >= 0) {
      sandboxCmd.args.splice(nixIdx, 0, `--setenv=SSH_AUTH_SOCK=${socketPath}`);
    }

    // Add socket path to BindPaths so sandboxed process can access it
    const bindPathIdx = sandboxCmd.args.findIndex(a => a.startsWith('--property=BindPaths='));
    if (bindPathIdx >= 0) {
      sandboxCmd.args[bindPathIdx] += ` ${socketPath}`;
    }
  }
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return url.searchParams;
}

export function mountSessionRoutes(apiRoutes: Map<string, RouteHandler>, cfg: Config, pushService?: PushService): void {
  // POST /api/projects/:id/sessions — start a new session
  apiRoutes.set('POST /api/projects/:id/sessions', async (req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const raw = await readBody(req);
    let parsed: { type?: string; allowUnsandboxed?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const sessionType = parsed.type;
    if (sessionType !== 'task-run' && sessionType !== 'interview') {
      sendJson(res, 400, { error: 'Invalid or missing "type" field. Must be "task-run" or "interview".' });
      return;
    }

    // For task-run, check that unchecked tasks remain
    if (sessionType === 'task-run') {
      const taskFilePath = join(project.dir, project.taskFile);
      try {
        const summary = parseTaskSummary(taskFilePath);
        if (summary.remaining === 0 && summary.blocked === 0) {
          sendJson(res, 400, { error: 'No unchecked tasks remaining' });
          return;
        }
      } catch (err) {
        sendJson(res, 400, { error: `Failed to parse task file: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    }

    // Ensure agent framework is up-to-date before each session (FR-004)
    try {
      ensureAgentFramework(cfg.dataDir);
    } catch (err) {
      log.error({ err }, 'Failed to ensure agent framework');
      sendJson(res, 503, { error: 'Failed to prepare agent framework' });
      return;
    }

    // Build sandbox command — may throw if sandbox unavailable and gates not satisfied
    const allowUnsandboxed = parsed.allowUnsandboxed === true;
    const prompt = sessionType === 'task-run' ? DEFAULT_TASK_RUN_PROMPT : undefined;
    let sandboxCmd;
    try {
      sandboxCmd = buildCommand(project.dir, sessionType as SessionType, {
        agentFrameworkDir: cfg.agentFrameworkDir,
        allowUnsandboxed,
        prompt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check if this is an unsandboxed request without server gate
      if (!cfg.allowUnsandboxed && allowUnsandboxed) {
        sendJson(res, 400, { error: 'allowUnsandboxed requested but server ALLOW_UNSANDBOXED env var not set' });
      } else {
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // Create session (enforces one active session per project)
    let session;
    try {
      session = createSession(cfg.dataDir, { projectId: project.id, type: sessionType });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 409, { error: message });
      return;
    }

    // Log unsandboxed warning
    if (sandboxCmd.unsandboxed) {
      log.warn({ sessionId: session.id, projectId: project.id }, 'Running session WITHOUT sandbox');
    }

    // Set up SSH agent bridge if project has SSH remote
    const bridgeSocketPath = await setupBridge(session.id, project.dir, cfg.dataDir);
    if (bridgeSocketPath) {
      injectSSHAuthSock(sandboxCmd, bridgeSocketPath);
    }

    const logPath = join(cfg.dataDir, 'sessions', session.id, 'output.jsonl');
    const logger = createSessionLogger(logPath);

    if (sessionType === 'task-run') {
      const taskFilePath = join(project.dir, project.taskFile);

      // Start the task loop in the background — don't await
      startTaskLoop({
        command: sandboxCmd.command,
        args: sandboxCmd.args,
        sessionId: session.id,
        projectId: project.id,
        projectName: project.name,
        taskFilePath,
        logger,
        dataDir: cfg.dataDir,
        env: sandboxCmd.env,
        pushService,
      }).then((result) => {
        unregisterProcess(session.id);
        if (result.outcome !== 'waiting-for-input') {
          cleanupBridge(session.id).catch(err => log.warn({ err }, 'Bridge cleanup error'));
        }
        log.info({ sessionId: session.id, outcome: result.outcome, spawnCount: result.spawnCount }, 'Task loop finished');
      }).catch((err) => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(e => log.warn({ e }, 'Bridge cleanup error'));
        log.error({ sessionId: session.id, err }, 'Task loop error');
      });

      // For task-run, we don't have a single ProcessHandle to track since the loop manages its own spawns.
      // The startTaskLoop function manages process lifecycle internally.

      log.info({ sessionId: session.id, projectId: project.id, type: sessionType }, 'Session started');

      // Broadcast session start to dashboard
      try {
        const startSummary = parseTaskSummary(taskFilePath);
        broadcastProjectUpdate({
          projectId: project.id,
          activeSession: { id: session.id, type: session.type, state: session.state },
          taskSummary: startSummary,
          workflow: null,
        });
      } catch {
        // Task summary parse failure shouldn't block session start
      }

      sendJson(res, 201, {
        id: session.id,
        projectId: session.projectId,
        type: session.type,
        state: session.state,
        startedAt: session.startedAt,
        pid: session.pid,
      });
    } else {
      // Interview type — spawn a single process with stdin piped
      const handle = spawnProcess({
        command: sandboxCmd.command,
        args: sandboxCmd.args,
        sessionId: session.id,
        logger,
        dataDir: cfg.dataDir,
        env: sandboxCmd.env,
      });

      registerProcess(session.id, handle);

      // Update session with PID
      const updated = getSession(cfg.dataDir, session.id)!;
      updated.pid = handle.pid;
      // Write updated pid back — session model doesn't have a setPid, update meta.json directly
      writeFileSync(
        join(cfg.dataDir, 'sessions', session.id, 'meta.json'),
        JSON.stringify({ ...updated, pid: handle.pid }, null, 2) + '\n',
        'utf-8',
      );

      // Handle process exit in background
      handle.waitForExit().then((result) => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(err => log.warn({ err }, 'Bridge cleanup error'));
        const newState = result.exitCode === 0 ? 'completed' as const : 'failed' as const;
        transitionState(cfg.dataDir, session.id, newState, { exitCode: result.exitCode });
        broadcastSessionState(session.id, { state: newState });
        broadcastProjectUpdate({
          projectId: project.id,
          activeSession: null,
          taskSummary: null,
          workflow: null,
        });
        if (pushService) {
          const title = newState === 'completed'
            ? `Completed: ${project.name}`
            : `Session failed: ${project.name}`;
          const body = newState === 'completed'
            ? 'Interview session completed'
            : `Process exited with code ${result.exitCode}`;
          pushService.sendToAll({ title, body, data: { projectId: project.id, sessionId: session.id } })
            .catch(err => log.warn({ err }, 'Failed to send push notification'));
        }
      }).catch(() => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(() => {});
      });

      log.info({ sessionId: session.id, projectId: project.id, type: sessionType, pid: handle.pid }, 'Session started');

      // Broadcast session start to dashboard
      broadcastProjectUpdate({
        projectId: project.id,
        activeSession: { id: session.id, type: session.type, state: session.state },
        taskSummary: null,
        workflow: null,
      });

      sendJson(res, 201, {
        id: session.id,
        projectId: session.projectId,
        type: session.type,
        state: session.state,
        startedAt: session.startedAt,
        pid: handle.pid,
      });
    }
  });

  // GET /api/projects/:id/sessions — list sessions for a project
  apiRoutes.set('GET /api/projects/:id/sessions', (_req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const sessions = listSessionsByProject(cfg.dataDir, project.id);
    // Sort most recent first
    sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const result = sessions.map(s => ({
      id: s.id,
      type: s.type,
      state: s.state,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      exitCode: s.exitCode,
    }));

    sendJson(res, 200, result);
  });

  // GET /api/sessions/:id — get session details
  apiRoutes.set('GET /api/sessions/:id', (_req, res, params) => {
    const session = getSession(cfg.dataDir, params.id!);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }

    sendJson(res, 200, session);
  });

  // POST /api/sessions/:id/stop — stop a running session
  apiRoutes.set('POST /api/sessions/:id/stop', async (_req, res, params) => {
    const session = getSession(cfg.dataDir, params.id!);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }

    if (session.state !== 'running') {
      sendJson(res, 400, { error: 'Session is not in running state' });
      return;
    }

    // Kill the process if we have a handle
    const handle = getActiveProcess(session.id);
    if (handle) {
      killProcess(handle);
      unregisterProcess(session.id);
    }

    // Clean up SSH agent bridge
    await cleanupBridge(session.id);

    // Transition to failed with exitCode -1 (manual stop)
    const updated = transitionState(cfg.dataDir, session.id, 'failed', { exitCode: -1 });

    // Broadcast state change to connected WebSocket clients
    broadcastSessionState(session.id, { state: updated.state });
    broadcastProjectUpdate({
      projectId: session.projectId,
      activeSession: null,
      taskSummary: null,
      workflow: null,
    });

    log.info({ sessionId: session.id }, 'Session stopped by user');

    sendJson(res, 200, {
      id: updated.id,
      state: updated.state,
      endedAt: updated.endedAt,
      exitCode: updated.exitCode,
    });
  });

  // POST /api/sessions/:id/input — submit user input to a blocked session
  apiRoutes.set('POST /api/sessions/:id/input', async (req, res, params) => {
    const session = getSession(cfg.dataDir, params.id!);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }

    if (session.state !== 'waiting-for-input') {
      sendJson(res, 400, { error: 'Session is not in waiting-for-input state' });
      return;
    }

    const raw = await readBody(req);
    let parsed: { answer?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.answer || parsed.answer.trim() === '') {
      sendJson(res, 400, { error: 'Empty answer' });
      return;
    }

    const answer = parsed.answer.trim();

    // Get the project to rebuild the sandbox command and task file path
    const project = getProject(cfg.dataDir, session.projectId);
    if (!project) {
      sendJson(res, 500, { error: 'Project not found for session' });
      return;
    }

    // Log the user's answer to the existing session log
    const logPath = join(cfg.dataDir, 'sessions', session.id, 'output.jsonl');
    const logger = createSessionLogger(logPath);
    await logger.write({ stream: 'system', content: `User answered: ${answer}` });

    // Transition session back to running
    const updated = transitionState(cfg.dataDir, session.id, 'running');

    // Broadcast state change
    broadcastSessionState(session.id, { state: 'running' });
    broadcastProjectUpdate({
      projectId: session.projectId,
      activeSession: { id: session.id, type: session.type, state: 'running' },
      taskSummary: null,
      workflow: null,
    });

    // Build sandbox command for re-spawn
    const respawnPrompt = session.type === 'task-run' ? DEFAULT_TASK_RUN_PROMPT : undefined;
    let sandboxCmd;
    try {
      sandboxCmd = buildCommand(project.dir, session.type as SessionType, {
        agentFrameworkDir: cfg.agentFrameworkDir,
        prompt: respawnPrompt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 503, { error: message });
      return;
    }

    // Reuse existing bridge if available, otherwise set up a new one
    const existingBridge = activeBridges.get(session.id);
    if (existingBridge) {
      injectSSHAuthSock(sandboxCmd, existingBridge.socketPath);
    } else {
      const bridgeSocketPath = await setupBridge(session.id, project.dir, cfg.dataDir);
      if (bridgeSocketPath) {
        injectSSHAuthSock(sandboxCmd, bridgeSocketPath);
      }
    }

    if (session.type === 'task-run') {
      const taskFilePath = join(project.dir, project.taskFile);

      // Restart the task loop — it will re-parse the task file and continue
      startTaskLoop({
        command: sandboxCmd.command,
        args: sandboxCmd.args,
        sessionId: session.id,
        projectId: project.id,
        projectName: project.name,
        taskFilePath,
        logger,
        dataDir: cfg.dataDir,
        env: sandboxCmd.env,
        pushService,
      }).then((result) => {
        unregisterProcess(session.id);
        if (result.outcome !== 'waiting-for-input') {
          cleanupBridge(session.id).catch(err => log.warn({ err }, 'Bridge cleanup error'));
        }
        log.info({ sessionId: session.id, outcome: result.outcome, spawnCount: result.spawnCount }, 'Task loop resumed after input');
      }).catch((err) => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(e => log.warn({ e }, 'Bridge cleanup error'));
        log.error({ sessionId: session.id, err }, 'Task loop error after input');
      });
    } else {
      // Interview type — spawn a new process with stdin piped
      const handle = spawnProcess({
        command: sandboxCmd.command,
        args: sandboxCmd.args,
        sessionId: session.id,
        logger,
        dataDir: cfg.dataDir,
        env: sandboxCmd.env,
      });

      registerProcess(session.id, handle);

      // Update session PID
      const sessionWithPid = getSession(cfg.dataDir, session.id)!;
      sessionWithPid.pid = handle.pid;
      writeFileSync(
        join(cfg.dataDir, 'sessions', session.id, 'meta.json'),
        JSON.stringify({ ...sessionWithPid, pid: handle.pid }, null, 2) + '\n',
        'utf-8',
      );

      // Handle process exit
      handle.waitForExit().then((result) => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(err => log.warn({ err }, 'Bridge cleanup error'));
        const newState = result.exitCode === 0 ? 'completed' as const : 'failed' as const;
        transitionState(cfg.dataDir, session.id, newState, { exitCode: result.exitCode });
        broadcastSessionState(session.id, { state: newState });
        broadcastProjectUpdate({
          projectId: session.projectId,
          activeSession: null,
          taskSummary: null,
          workflow: null,
        });
        if (pushService) {
          const title = newState === 'completed'
            ? `Completed: ${project.name}`
            : `Session failed: ${project.name}`;
          const body = newState === 'completed'
            ? 'Interview session completed'
            : `Process exited with code ${result.exitCode}`;
          pushService.sendToAll({ title, body, data: { projectId: project.id, sessionId: session.id } })
            .catch(err => log.warn({ err }, 'Failed to send push notification'));
        }
      }).catch(() => {
        unregisterProcess(session.id);
        cleanupBridge(session.id).catch(() => {});
      });

      updated.pid = handle.pid;
    }

    log.info({ sessionId: session.id, projectId: project.id }, 'Session resumed after user input');

    sendJson(res, 200, {
      id: updated.id,
      projectId: updated.projectId,
      type: updated.type,
      state: updated.state,
      startedAt: updated.startedAt,
      pid: updated.pid,
    });
  });

  // GET /api/sessions/:id/log — get session log as JSON array
  apiRoutes.set('GET /api/sessions/:id/log', async (req, res, params) => {
    const session = getSession(cfg.dataDir, params.id!);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }

    const logPath = join(cfg.dataDir, 'sessions', session.id, 'output.jsonl');

    try {
      const entries = await readLog(logPath);

      // Filter by afterSeq if provided
      const queryParams = parseQueryParams(req);
      const afterSeqStr = queryParams.get('afterSeq');
      if (afterSeqStr !== null) {
        const afterSeq = parseInt(afterSeqStr, 10);
        if (!isNaN(afterSeq)) {
          const filtered = entries.filter(e => e.seq > afterSeq);
          sendJson(res, 200, filtered);
          return;
        }
      }

      sendJson(res, 200, entries);
    } catch {
      // Log file doesn't exist yet or is empty — return empty array
      sendJson(res, 200, []);
    }
  });
}
