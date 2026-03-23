import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import type { Config } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { listProjects, getProject, createProject, removeProject } from '../models/project.js';
import { createSession } from '../models/session.js';
import { parseTasks, parseTaskSummary } from '../services/task-parser.js';
import { startAddFeatureWorkflow, type SpecKitDeps, type PhaseResult } from '../services/spec-kit.js';
import { buildCommand } from '../services/sandbox.js';
import { spawnProcess } from '../services/process-manager.js';
import { createSessionLogger } from '../services/session-logger.js';
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
  // GET /api/projects — list all with taskSummary and activeSession
  apiRoutes.set('GET /api/projects', (_req, res) => {
    const projects = listProjects(cfg.dataDir);
    const result = projects.map((p) => ({
      ...p,
      taskSummary: safeParseTaskSummary(p),
      activeSession: getActiveSession(cfg.dataDir, p.id),
    }));
    sendJson(res, 200, result);
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
    const deps: SpecKitDeps = {
      createSessionId: () => {
        sessionCounter++;
        if (sessionCounter === 1) return firstSessionId;
        return randomUUID();
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
    }).catch((err) => {
      log.error({ projectId: project.id, err }, 'Add-feature workflow error');
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
}
