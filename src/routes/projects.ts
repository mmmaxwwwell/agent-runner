import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Config } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { listProjects, getProject, createProject, removeProject, registerForOnboarding, updateProjectStatus, updateProjectDescription, type DiscoveredDirectory } from '../models/project.js';
import { createSession } from '../models/session.js';
import { parseTasks, parseTaskSummary } from '../services/task-parser.js';
import { scanProjectsDir } from '../services/discovery.js';
import { startAddFeatureWorkflow, startPlanningPhases, type SpecKitDeps, type PhaseResult, type PhaseTransitionEvent } from '../services/spec-kit.js';
import { buildCommand } from '../services/sandbox.js';
import { ensureAgentFramework } from '../services/agent-framework.js';
import { spawnProcess } from '../services/process-manager.js';
import { createSessionLogger } from '../services/session-logger.js';
import { broadcastPhaseTransition } from '../ws/session-stream.js';
import { broadcastProjectUpdate, broadcastOnboardingStep } from '../ws/dashboard.js';
import { setupBridge, cleanupBridge, injectSSHAuthSock } from './sessions.js';
import { runOnboardingPipeline, validateNewProjectName, NewProjectValidationError, type OnboardingContext } from '../services/onboarding.js';
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
      buildCommand(project.dir, 'interview', {
        agentFrameworkDir: cfg.agentFrameworkDir,
        allowUnsandboxed,
      });
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
      runPhase: async (phase: string, projectDir: string, sessionId: string, prompt?: string): Promise<PhaseResult> => {
        // Post-interview phases use task-run session type (prompt is required);
        // interview phase uses interview type (prompt is optional)
        const sessionType = phase === 'interview' ? 'interview' : 'task-run';

        // For the first phase, the session is already created
        // For subsequent phases, create a new session
        if (sessionId !== firstSessionId) {
          createSession(cfg.dataDir, { projectId: project.id, type: sessionType });
        }

        // Ensure agent framework is up-to-date before each session (FR-004)
        ensureAgentFramework(cfg.dataDir);

        // Pass through the prompt from the workflow (interview wrapper for interview phase,
        // context-loading prompts for plan/tasks/analyze phases per T027/FR-042)
        const sandboxCmd = buildCommand(projectDir, sessionType, {
          agentFrameworkDir: cfg.agentFrameworkDir,
          allowUnsandboxed,
          prompt,
        });

        // Set up SSH agent bridge if project has SSH remote
        const bridgeSocketPath = await setupBridge(sessionId, projectDir, cfg.dataDir);
        if (bridgeSocketPath) {
          injectSSHAuthSock(sandboxCmd, bridgeSocketPath);
        }

        const logPath = join(cfg.dataDir, 'sessions', sessionId, 'output.jsonl');
        const logger = createSessionLogger(logPath);
        const handle = spawnProcess({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          sessionId,
          logger,
          dataDir: cfg.dataDir,
          env: sandboxCmd.env,
        });

        const result = await handle.waitForExit();
        await cleanupBridge(sessionId);
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
      agentFrameworkDir: cfg.agentFrameworkDir,
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

  // POST /api/projects/onboard — unified onboarding endpoint for discovered dirs and new projects
  apiRoutes.set('POST /api/projects/onboard', async (req, res) => {
    const raw = await readBody(req);
    let parsed: {
      name?: string;
      path?: string;
      newProject?: boolean;
      remoteUrl?: string;
      createGithubRepo?: boolean;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const isNewProject = parsed.newProject === true;

    // Validate mutually exclusive remote options
    if (parsed.remoteUrl && parsed.createGithubRepo) {
      sendJson(res, 400, { error: 'remoteUrl and createGithubRepo are mutually exclusive' });
      return;
    }

    let projectDir: string;
    let projectName: string;

    if (isNewProject) {
      // New project: name is required, path is derived from projectsDir
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'Missing or empty name for new project' });
        return;
      }

      try {
        const validation = validateNewProjectName(name, cfg.dataDir, cfg.projectsDir);
        projectDir = validation.projectDir;
        projectName = validation.existingProject ? validation.existingProject.name : name;
      } catch (err) {
        if (err instanceof NewProjectValidationError) {
          const status = err.code === 'duplicate-name' || err.code === 'directory-exists' ? 409 : 400;
          sendJson(res, status, { error: err.message });
          return;
        }
        throw err;
      }
    } else {
      // Discovered directory: path is required
      if (!parsed.path || typeof parsed.path !== 'string') {
        sendJson(res, 400, { error: 'Missing or invalid "path" field' });
        return;
      }

      projectDir = resolve(parsed.path);

      // Validate path exists
      if (!existsSync(projectDir)) {
        sendJson(res, 400, { error: `Path does not exist: ${parsed.path}` });
        return;
      }

      // Validate path is a directory
      const stat = statSync(projectDir);
      if (!stat.isDirectory()) {
        sendJson(res, 400, { error: `Path is not a directory: ${parsed.path}` });
        return;
      }

      projectName = (parsed.name && typeof parsed.name === 'string') ? parsed.name.trim() : projectDir.split('/').pop() || 'unnamed';

      // Check if already registered
      const existingProjects = listProjects(cfg.dataDir);
      const existingByDir = existingProjects.find(p => resolve(p.dir) === projectDir);
      if (existingByDir) {
        // Allow re-onboard if status is "onboarding" or "error"
        if (existingByDir.status === 'onboarding' || existingByDir.status === 'error') {
          projectName = existingByDir.name;
        } else {
          sendJson(res, 409, { error: `A project with this directory is already registered: ${parsed.path}` });
          return;
        }
      }
    }

    // Synchronously register or find existing project
    let projectId: string;
    const allProjects = listProjects(cfg.dataDir);
    const existingProject = allProjects.find(p => resolve(p.dir) === resolve(projectDir));

    if (existingProject) {
      projectId = existingProject.id;
      // If re-onboarding from error, reset status
      if (existingProject.status === 'error') {
        updateProjectStatus(cfg.dataDir, existingProject.id, 'onboarding');
      }
    } else {
      // For new projects, create directory first if needed
      if (isNewProject) {
        mkdirSync(projectDir, { recursive: true });
      }
      try {
        const project = registerForOnboarding(cfg.dataDir, { name: projectName, dir: projectDir });
        projectId = project.id;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('already registered')) {
          sendJson(res, 409, { error: message });
        } else {
          sendJson(res, 400, { error: message });
        }
        return;
      }
    }

    // Pre-create an interview session so we can return its ID immediately
    // For re-onboards, reuse the existing active session if one exists
    let sessionId: string;
    const activeSession = getActiveSession(cfg.dataDir, projectId) as { id: string } | null;
    if (activeSession) {
      sessionId = activeSession.id;
    } else {
      const session = createSession(cfg.dataDir, { projectId, type: 'interview' });
      sessionId = session.id;
    }

    // Build the onboarding context and run pipeline async (fire-and-forget)
    const ctx: OnboardingContext = {
      dataDir: cfg.dataDir,
      projectDir,
      projectName,
      projectId,
      agentFrameworkDir: cfg.agentFrameworkDir,
      allowUnsandboxed: cfg.allowUnsandboxed,
      newProject: isNewProject,
      projectsDir: cfg.projectsDir,
      remoteUrl: parsed.remoteUrl,
      createGithubRepo: parsed.createGithubRepo,
      onStepStart: (step) => {
        broadcastOnboardingStep({ projectId, step, status: 'started' });
      },
      onStepComplete: (step, status, error) => {
        broadcastOnboardingStep({ projectId, step, status, ...(error ? { error } : {}) });
      },
    };

    // Fire pipeline async — it will skip register (already done) and handle remaining steps
    runOnboardingPipeline(ctx).then((result) => {
      log.info({ projectId: result.projectId, name: result.name, path: result.path }, 'Onboarding pipeline completed');
    }).catch((err) => {
      log.error({ err, projectDir, projectName }, 'Onboarding pipeline failed');
    });

    log.info({ projectId, sessionId, name: projectName, path: projectDir }, 'Project onboarded via unified endpoint');
    sendJson(res, 201, {
      projectId,
      sessionId,
      name: projectName,
      path: projectDir,
      status: 'onboarding' as const,
    });
  });

  // POST /api/projects/:id/start-planning — explicit user trigger for planning transition (FR-043)
  apiRoutes.set('POST /api/projects/:id/start-planning', async (_req, res, params) => {
    const project = getProject(cfg.dataDir, params.id!);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }

    // Only onboarding projects can transition to planning
    if (project.status !== 'onboarding') {
      sendJson(res, 400, { error: `Project status is "${project.status}", expected "onboarding"` });
      return;
    }

    // Verify no active session (interview should be completed)
    const active = getActiveSession(cfg.dataDir, project.id);
    if (active) {
      sendJson(res, 409, { error: 'Project has an active session. Complete or stop the interview first.' });
      return;
    }

    // Transition status from onboarding to active (FR-030a)
    try {
      updateProjectStatus(cfg.dataDir, project.id, 'active');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: message });
      return;
    }

    // Extract project description from interview-notes.md if available
    try {
      const specsDir = join(project.dir, 'specs');
      if (existsSync(specsDir)) {
        const specDirs = readdirSync(specsDir).filter(d => statSync(join(specsDir, d)).isDirectory());
        for (const specDir of specDirs) {
          const notesPath = join(specsDir, specDir, 'interview-notes.md');
          if (existsSync(notesPath)) {
            const notes = readFileSync(notesPath, 'utf-8');
            // Extract first non-empty, non-heading line as description
            const lines = notes.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                updateProjectDescription(cfg.dataDir, project.id, trimmed);
                break;
              }
            }
            break; // Use the first spec dir with interview-notes.md
          }
        }
      }
    } catch (err) {
      // Non-fatal — description is optional
      log.warn({ projectId: project.id, err }, 'Failed to extract project description from interview-notes.md');
    }

    // Create the first planning session
    let session;
    try {
      session = createSession(cfg.dataDir, { projectId: project.id, type: 'task-run' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 409, { error: message });
      return;
    }

    const firstSessionId = session.id;
    let sessionCounter = 0;
    const deps: SpecKitDeps = {
      createSessionId: () => {
        sessionCounter++;
        if (sessionCounter === 1) return firstSessionId;
        return randomUUID();
      },
      onPhaseTransition: (event: PhaseTransitionEvent) => {
        broadcastPhaseTransition(firstSessionId, event);
        broadcastProjectUpdate({
          projectId: project.id,
          activeSession: {
            id: event.sessionId,
            type: 'task-run',
            state: 'running',
          },
          taskSummary: safeParseTaskSummary(project),
          workflow: {
            type: event.workflow,
            phase: event.phase,
            iteration: event.iteration,
            description: 'Planning from interview',
          },
        });
      },
      runPhase: async (phase: string, projectDir: string, sessionId: string, prompt?: string): Promise<PhaseResult> => {
        // All planning phases use task-run session type (prompt is required)
        if (sessionId !== firstSessionId) {
          createSession(cfg.dataDir, { projectId: project.id, type: 'task-run' });
        }

        ensureAgentFramework(cfg.dataDir);

        const sandboxCmd = buildCommand(projectDir, 'task-run', {
          agentFrameworkDir: cfg.agentFrameworkDir,
          allowUnsandboxed: cfg.allowUnsandboxed,
          prompt,
        });

        // Set up SSH agent bridge if project has SSH remote
        const bridgeSocketPath = await setupBridge(sessionId, projectDir, cfg.dataDir);
        if (bridgeSocketPath) {
          injectSSHAuthSock(sandboxCmd, bridgeSocketPath);
        }

        const logPath = join(cfg.dataDir, 'sessions', sessionId, 'output.jsonl');
        const logger = createSessionLogger(logPath);
        const handle = spawnProcess({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          sessionId,
          logger,
          dataDir: cfg.dataDir,
          env: sandboxCmd.env,
        });

        const result = await handle.waitForExit();
        await cleanupBridge(sessionId);
        return { exitCode: result.exitCode };
      },
      analyzeHasIssues: async (_projectDir: string): Promise<boolean> => {
        return false;
      },
      registerProject: async (_name: string, _dir: string): Promise<string> => {
        return project.id;
      },
      launchTaskRun: async (_projectId: string): Promise<void> => {
        // TODO: wire up to actual task run launch
      },
    };

    // Launch planning phases async (fire-and-forget)
    startPlanningPhases({
      projectDir: project.dir,
      agentFrameworkDir: cfg.agentFrameworkDir,
      deps,
    }).then((result) => {
      log.info({ projectId: project.id, outcome: result.outcome }, 'Planning phases finished');
      broadcastProjectUpdate({
        projectId: project.id,
        activeSession: result.outcome === 'completed' ? getActiveSession(cfg.dataDir, project.id) as any : null,
        taskSummary: safeParseTaskSummary(project),
        workflow: null,
      });
    }).catch((err) => {
      log.error({ projectId: project.id, err }, 'Planning phases error');
      broadcastProjectUpdate({
        projectId: project.id,
        activeSession: null,
        taskSummary: safeParseTaskSummary(project),
        workflow: null,
      });
    });

    log.info({ projectId: project.id, sessionId: session.id }, 'Planning transition triggered');
    sendJson(res, 200, {
      projectId: project.id,
      sessionId: session.id,
      status: 'active',
      phase: 'plan',
    });
  });

  // POST /api/workflows/new-project — DEPRECATED: use POST /api/projects/onboard with newProject: true
  // Kept as redirect for backward compatibility during transition
  apiRoutes.set('POST /api/workflows/new-project', async (_req, res) => {
    sendJson(res, 410, { error: 'This endpoint has been removed. Use POST /api/projects/onboard with newProject: true' });
  });
}
