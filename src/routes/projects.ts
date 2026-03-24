import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Config } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { listProjects, getProject, createProject, removeProject, registerForOnboarding, type DiscoveredDirectory } from '../models/project.js';
import { createSession } from '../models/session.js';
import { parseTasks, parseTaskSummary } from '../services/task-parser.js';
import { scanProjectsDir } from '../services/discovery.js';
import { ensureFlakeNix } from '../services/flake-generator.js';
import { startAddFeatureWorkflow, startNewProjectWorkflow, type SpecKitDeps, type PhaseResult, type PhaseTransitionEvent } from '../services/spec-kit.js';
import { buildCommand } from '../services/sandbox.js';
import { spawnProcess } from '../services/process-manager.js';
import { createSessionLogger } from '../services/session-logger.js';
import { broadcastPhaseTransition } from '../ws/session-stream.js';
import { broadcastProjectUpdate } from '../ws/dashboard.js';
import { randomUUID } from 'node:crypto';

const log = createLogger('server');

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

function getTaskFilePath(project: { dir: string; taskFile: string }): string {
  return join(project.dir, project.taskFile);
}

function safeParseTaskSummary(project: { dir: string; taskFile: string }) {
  try {
    return parseTaskSummary(getTaskFilePath(project));
  } catch {
    return { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 };
  }
}

function safeParseTasks(project: { dir: string; taskFile: string }) {
  try {
    return parseTasks(getTaskFilePath(project));
  } catch {
    return [];
  }
}

/** List sessions for a project from the sessions directory. Returns metadata only. */
function listSessionsForProject(dataDir: string, projectId: string): unknown[] {
  const sessionsDir = join(dataDir, 'sessions');
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    const sessions: unknown[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metaPath = join(sessionsDir, entry.name, 'meta.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        if (meta.projectId === projectId) {
          sessions.push({
            id: meta.id,
            type: meta.type,
            state: meta.state,
            startedAt: meta.startedAt,
            endedAt: meta.endedAt ?? null,
            exitCode: meta.exitCode ?? null,
          });
        }
      } catch {
        // Skip sessions with missing/invalid meta.json
      }
    }
    // Most recent first
    sessions.sort((a: any, b: any) => {
      const ta = new Date(a.startedAt).getTime();
      const tb = new Date(b.startedAt).getTime();
      return tb - ta;
    });
    return sessions;
  } catch {
    return [];
  }
}

/** Find the active session (running or waiting-for-input) for a project */
function getActiveSession(dataDir: string, projectId: string): unknown | null {
  const sessions = listSessionsForProject(dataDir, projectId) as any[];
  const active = sessions.find(
    (s) => s.state === 'running' || s.state === 'waiting-for-input'
  );
  if (!active) return null;
  return {
    id: active.id,
    type: active.type,
    state: active.state,
    startedAt: active.startedAt,
  };
}

export function mountProjectRoutes(apiRoutes: Map<string, RouteHandler>, cfg: Config): void {
  // GET /api/projects — list registered + discovered with taskSummary and activeSession
  apiRoutes.set('GET /api/projects', async (_req, res) => {
    const projects = listProjects(cfg.dataDir);
    const registered = projects.map((p) => ({
      type: 'registered' as const,
      ...p,
      taskSummary: safeParseTaskSummary(p),
      activeSession: getActiveSession(cfg.dataDir, p.id),
      dirMissing: !existsSync(p.dir),
    }));

    // Discover unregistered directories
    let discovered: DiscoveredDirectory[] = [];
    let discoveryError: string | null = null;

    if (!existsSync(cfg.projectsDir)) {
      discoveryError = `Projects directory does not exist: ${cfg.projectsDir}`;
    } else {
      try {
        const registeredPaths = new Set(projects.map((p) => resolve(p.dir)));
        discovered = await scanProjectsDir(cfg.projectsDir, registeredPaths);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        discoveryError = `Failed to scan projects directory: ${message}`;
        log.error({ err }, 'Failed to scan projects directory');
      }
    }

    sendJson(res, 200, { registered, discovered, discoveryError });
  });

  // POST /api/projects — register a new project
  apiRoutes.set('POST /api/projects', async (req, res) => {
    const raw = await readBody(req);
    let parsed: { name?: string; dir?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      sendJson(res, 400, { error: 'Missing or invalid "name" field' });
      return;
    }
    if (!parsed.dir || typeof parsed.dir !== 'string') {
      sendJson(res, 400, { error: 'Missing or invalid "dir" field' });
      return;
    }

    try {
      const project = createProject(cfg.dataDir, { name: parsed.name, dir: parsed.dir });
      log.info({ projectId: project.id, name: project.name, dir: project.dir }, 'Project registered');
      sendJson(res, 201, project);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already registered')) {
        sendJson(res, 409, { error: message });
      } else {
        sendJson(res, 400, { error: message });
      }
    }
  });

  // GET /api/projects/:id — detail with tasks[], sessions[], taskSummary, activeSession
  apiRoutes.set('GET /api/projects/:id', (_req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    sendJson(res, 200, {
      ...project,
      taskSummary: safeParseTaskSummary(project),
      tasks: safeParseTasks(project),
      activeSession: getActiveSession(cfg.dataDir, project.id),
      sessions: listSessionsForProject(cfg.dataDir, project.id),
    });
  });

  // POST /api/projects/:id/add-feature — start spec-kit SDD workflow for a new feature
  apiRoutes.set('POST /api/projects/:id/add-feature', async (req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const raw = await readBody(req);
    let parsed: { description?: string; allowUnsandboxed?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.description || typeof parsed.description !== 'string' || parsed.description.trim() === '') {
      sendJson(res, 400, { error: 'Missing or empty description' });
      return;
    }

    // Check no active session (FR-012)
    const active = getActiveSession(cfg.dataDir, project.id);
    if (active) {
      sendJson(res, 409, { error: 'Project already has an active session' });
      return;
    }

    // Check sandbox availability
    const allowUnsandboxed = parsed.allowUnsandboxed === true;
    try {
      buildCommand(project.dir, [], allowUnsandboxed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!cfg.allowUnsandboxed && allowUnsandboxed) {
        sendJson(res, 400, { error: 'allowUnsandboxed requested but server ALLOW_UNSANDBOXED env var not set' });
      } else {
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // Create the first session (specify phase) as an interview
    let session;
    try {
      session = createSession(cfg.dataDir, { projectId: project.id, type: 'interview' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 409, { error: message });
      return;
    }

    const description = parsed.description.trim();

    log.info({ sessionId: session.id, projectId: project.id, description }, 'Add-feature workflow started');

    // Kick off the workflow asynchronously — the first phase reuses the session we just created
    const firstSessionId = session.id;
    let sessionCounter = 0;
    // Track the latest session ID so phase transitions broadcast to the right session-stream clients
    let currentSessionId = firstSessionId;
    const deps: SpecKitDeps = {
      createSessionId: () => {
        sessionCounter++;
        if (sessionCounter === 1) return firstSessionId;
        return randomUUID();
      },
      onPhaseTransition: (event: PhaseTransitionEvent) => {
        currentSessionId = event.sessionId;
        // Broadcast phase message to session-stream clients watching the previous session
        // (they'll see the transition and know to connect to the new session)
        broadcastPhaseTransition(firstSessionId, event);

        // Broadcast project-update to dashboard with workflow info
        broadcastProjectUpdate({
          projectId: project.id,
          activeSession: {
            id: event.sessionId,
            type: 'interview',
            state: 'running',
          },
          taskSummary: safeParseTaskSummary(project),
          workflow: {
            type: event.workflow,
            phase: event.phase,
            iteration: event.iteration,
            description,
          },
        });
      },
      runPhase: async (phase: string, projectDir: string, sessionId: string): Promise<PhaseResult> => {
        // For the first phase, the session is already created
        // For subsequent phases, create a new session
        if (sessionId !== firstSessionId) {
          createSession(cfg.dataDir, { projectId: project.id, type: 'interview' });
        }

        const sandboxCmd = buildCommand(projectDir, [], allowUnsandboxed);
        const logPath = join(cfg.dataDir, 'sessions', sessionId, 'output.jsonl');
        const logger = createSessionLogger(logPath);
        const handle = spawnProcess({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          sessionId,
          logger,
          dataDir: cfg.dataDir,
        });

        const result = await handle.waitForExit();
        return { exitCode: result.exitCode };
      },
      analyzeHasIssues: async (_projectDir: string): Promise<boolean> => {
        // TODO: implement actual analyze issue detection
        return false;
      },
      registerProject: async (_name: string, _dir: string): Promise<string> => {
        // Not used for add-feature workflow
        return project.id;
      },
      launchTaskRun: async (_projectId: string): Promise<void> => {
        // TODO: wire up to actual task run launch
      },
    };

    startAddFeatureWorkflow({
      projectId: project.id,
      projectDir: project.dir,
      description,
      dataDir: cfg.dataDir,
      deps,
    }).then((result) => {
      log.info({ projectId: project.id, outcome: result.outcome }, 'Add-feature workflow finished');

      // Broadcast final dashboard update clearing workflow info
      broadcastProjectUpdate({
        projectId: project.id,
        activeSession: result.outcome === 'completed' ? getActiveSession(cfg.dataDir, project.id) as any : null,
        taskSummary: safeParseTaskSummary(project),
        workflow: null,
      });
    }).catch((err) => {
      log.error({ projectId: project.id, err }, 'Add-feature workflow error');

      broadcastProjectUpdate({
        projectId: project.id,
        activeSession: null,
        taskSummary: safeParseTaskSummary(project),
        workflow: null,
      });
    });

    // Return the first session info immediately
    sendJson(res, 201, {
      sessionId: session.id,
      projectId: project.id,
      phase: 'specify',
      state: session.state,
    });
  });

  // DELETE /api/projects/:id — unregister, reject if active session
  apiRoutes.set('DELETE /api/projects/:id', (_req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    const active = getActiveSession(cfg.dataDir, project.id);
    if (active) {
      sendJson(res, 409, { error: 'Project has an active session. Stop it first.' });
      return;
    }

    try {
      removeProject(cfg.dataDir, params.id!);
      res.writeHead(204);
      res.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 404, { error: message });
    }
  });

  // POST /api/projects/onboard — onboard a discovered directory
  apiRoutes.set('POST /api/projects/onboard', async (req, res) => {
    const raw = await readBody(req);
    let parsed: { name?: string; path?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.path || typeof parsed.path !== 'string') {
      sendJson(res, 400, { error: 'Missing or invalid "path" field' });
      return;
    }

    // Derive name from path basename if not provided
    const dirPath = parsed.path;
    const name = (parsed.name && typeof parsed.name === 'string') ? parsed.name.trim() : dirPath.split('/').pop() || 'unnamed';

    try {
      const project = registerForOnboarding(cfg.dataDir, { name, dir: dirPath });

      // Ensure the project has a flake.nix so nix develop works
      const flakeGenerated = ensureFlakeNix(dirPath);
      if (flakeGenerated) {
        log.info({ dir: dirPath }, 'Generated flake.nix for project');
      }

      log.info({ projectId: project.id, name, dir: dirPath }, 'Project onboarded');
      sendJson(res, 201, {
        projectId: project.id,
        name: project.name,
        path: project.dir,
        status: project.status,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already registered')) {
        sendJson(res, 409, { error: message });
      } else {
        sendJson(res, 400, { error: message });
      }
    }
  });

  // POST /api/workflows/new-project — create a new project and start spec-kit SDD workflow
  apiRoutes.set('POST /api/workflows/new-project', async (req, res) => {
    const raw = await readBody(req);
    let parsed: { name?: string; description?: string; allowUnsandboxed?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    // Validate name
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      sendJson(res, 400, { error: 'Missing or empty name' });
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      sendJson(res, 400, { error: 'Invalid project name: must contain only letters, numbers, dots, hyphens, underscores' });
      return;
    }

    // Validate description
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    if (!description) {
      sendJson(res, 400, { error: 'Missing or empty description' });
      return;
    }

    // Check duplicate name — registry and filesystem
    const existingProjects = listProjects(cfg.dataDir);
    if (existingProjects.some(p => p.name === name)) {
      sendJson(res, 409, { error: `A project with name '${name}' already exists` });
      return;
    }
    const targetDir = join(cfg.projectsDir, name);
    if (existsSync(targetDir)) {
      sendJson(res, 409, { error: `A project with name '${name}' already exists` });
      return;
    }

    // Check sandbox availability
    const allowUnsandboxed = parsed.allowUnsandboxed === true;
    if (allowUnsandboxed && !cfg.allowUnsandboxed) {
      sendJson(res, 400, { error: 'allowUnsandboxed requested but server ALLOW_UNSANDBOXED env var not set' });
      return;
    }
    try {
      buildCommand(targetDir, [], allowUnsandboxed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 503, { error: message });
      return;
    }

    // Create the first session (specify phase) as an interview
    // We need a placeholder project ID since the project isn't registered yet
    const placeholderProjectId = randomUUID();
    let session;
    try {
      session = createSession(cfg.dataDir, { projectId: placeholderProjectId, type: 'interview' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
      return;
    }

    log.info({ sessionId: session.id, name, description }, 'New-project workflow started');

    // Kick off the workflow asynchronously
    const firstSessionId = session.id;
    let sessionCounter = 0;
    let currentSessionId = firstSessionId;
    const deps: SpecKitDeps = {
      createSessionId: () => {
        sessionCounter++;
        if (sessionCounter === 1) return firstSessionId;
        return randomUUID();
      },
      onPhaseTransition: (event: PhaseTransitionEvent) => {
        currentSessionId = event.sessionId;
        broadcastPhaseTransition(firstSessionId, event);

        broadcastProjectUpdate({
          projectId: placeholderProjectId,
          activeSession: {
            id: event.sessionId,
            type: 'interview',
            state: 'running',
          },
          taskSummary: { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 },
          workflow: {
            type: event.workflow,
            phase: event.phase,
            iteration: event.iteration,
            description,
          },
        });
      },
      runPhase: async (phase: string, projectDir: string, sessionId: string): Promise<PhaseResult> => {
        if (sessionId !== firstSessionId) {
          createSession(cfg.dataDir, { projectId: placeholderProjectId, type: 'interview' });
        }

        const sandboxCmd = buildCommand(projectDir, [], allowUnsandboxed);
        const logPath = join(cfg.dataDir, 'sessions', sessionId, 'output.jsonl');
        const logger = createSessionLogger(logPath);
        const handle = spawnProcess({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          sessionId,
          logger,
          dataDir: cfg.dataDir,
        });

        const result = await handle.waitForExit();
        return { exitCode: result.exitCode };
      },
      analyzeHasIssues: async (_projectDir: string): Promise<boolean> => {
        return false;
      },
      registerProject: async (regName: string, dir: string): Promise<string> => {
        const project = createProject(cfg.dataDir, { name: regName, dir });
        log.info({ projectId: project.id, name: regName, dir }, 'Project auto-registered after workflow');
        return project.id;
      },
      launchTaskRun: async (_projectId: string): Promise<void> => {
        // TODO: wire up to actual task run launch
      },
    };

    startNewProjectWorkflow({
      repoName: name,
      description,
      projectsDir: cfg.projectsDir,
      dataDir: cfg.dataDir,
      deps,
    }).then((result) => {
      log.info({ name, outcome: result.outcome, projectId: result.projectId }, 'New-project workflow finished');

      broadcastProjectUpdate({
        projectId: result.projectId ?? placeholderProjectId,
        activeSession: null,
        taskSummary: { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 },
        workflow: null,
      });
    }).catch((err) => {
      log.error({ name, err }, 'New-project workflow error');

      broadcastProjectUpdate({
        projectId: placeholderProjectId,
        activeSession: null,
        taskSummary: { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 },
        workflow: null,
      });
    });

    // Return the first session info immediately
    sendJson(res, 201, {
      sessionId: session.id,
      projectId: placeholderProjectId,
      phase: 'specify',
      state: session.state,
    });
  });
}
