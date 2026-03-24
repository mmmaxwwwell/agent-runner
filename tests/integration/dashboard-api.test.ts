/**
 * Integration Tests: Dashboard & Project Detail API
 *
 * Validates the dashboard and project detail endpoints:
 * - Project list with task summaries (GET /api/projects)
 * - Project detail with sessions and tasks (GET /api/projects/:id)
 * - Project registration (POST /api/projects)
 * - Project deletion (DELETE /api/projects/:id)
 * - WebSocket dashboard updates on session state change
 *
 * Validates UI_FLOW.md § Dashboard, § Project Detail,
 * § API Endpoint Summary, and § WebSocket Paths
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TASK_FILE_CONTENT = `# Tasks: Test Project

## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
`;

const MIXED_TASK_FILE = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 Completed task
- [ ] 1.2 Remaining task
- [~] 1.3 Skipped task — not needed
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;
let wsBaseUrl: string;

const PORT = 30000 + Math.floor(Math.random() * 10000);

async function api(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const res = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: bodyStr,
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: '/home/max/git/agent-runner',
      env: {
        ...process.env,
        AGENT_RUNNER_HOST: '127.0.0.1',
        AGENT_RUNNER_PORT: String(PORT),
        AGENT_RUNNER_DATA_DIR: dataDir,
        AGENT_RUNNER_PROJECTS_DIR: projectsDir,
        ALLOW_UNSANDBOXED: 'true',
        VAPID_PUBLIC_KEY: 'BEK2EYfxuvIVaN3AD8zmJySnpAbJH0d0krsfVWou2UE0OOmBv8Wuslzb_jwDureGGeoJ1guHi4HgyqAGHyAGI0I',
        VAPID_PRIVATE_KEY: 'lyVcDma4tQXDj6SKHTHSv9MsUZB4juXzJK_JnaDyX2E',
        LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrOutput = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start within 10s. stderr: ${stderrOutput}`));
    }, 10_000);

    serverProcess.stderr!.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.includes('Agent Runner server started')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited with code ${code}. stderr: ${stderrOutput}`));
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
      resolve();
    }, 3000);
    serverProcess.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    serverProcess.kill('SIGTERM');
  });
}

/**
 * Pre-create a session directory with meta.json and optional JSONL log.
 * Bypasses process spawning for tests that need specific session states.
 */
function preCreateSession(opts: {
  id: string;
  projectId: string;
  type: 'task-run' | 'interview';
  state: 'running' | 'waiting-for-input' | 'completed' | 'failed';
  question?: string;
  exitCode?: number | null;
  startedAt?: string;
}): void {
  const sessionPath = join(dataDir, 'sessions', opts.id);
  mkdirSync(sessionPath, { recursive: true });

  const meta = {
    id: opts.id,
    projectId: opts.projectId,
    type: opts.type,
    state: opts.state,
    startedAt: opts.startedAt ?? new Date().toISOString(),
    endedAt: opts.state === 'completed' || opts.state === 'failed' ? new Date().toISOString() : null,
    pid: opts.state === 'running' ? 99999 : null,
    lastTaskId: null,
    question: opts.question ?? null,
    exitCode: opts.exitCode ?? null,
  };
  writeFileSync(join(sessionPath, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(sessionPath, 'output.jsonl'), '');
}

describe('Dashboard & Project Detail Integration Tests', () => {
  let projAId: string;
  let projBId: string;
  const projADir = () => join(projectsDir, 'project-alpha');
  const projBDir = () => join(projectsDir, 'project-beta');

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dashboard-api-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');

    // Create project directories with task files
    mkdirSync(projADir(), { recursive: true });
    writeFileSync(join(projADir(), 'tasks.md'), MIXED_TASK_FILE);

    mkdirSync(projBDir(), { recursive: true });
    writeFileSync(join(projBDir(), 'tasks.md'), TASK_FILE_CONTENT);

    baseUrl = `http://127.0.0.1:${PORT}`;
    wsBaseUrl = `ws://127.0.0.1:${PORT}`;
    await startServer();

    // Register two projects
    const resA = await api('/api/projects', {
      method: 'POST',
      body: { name: 'project-alpha', dir: projADir() },
    });
    assert.equal(resA.status, 201, 'Setup: project-alpha should register');
    projAId = resA.body.id;

    const resB = await api('/api/projects', {
      method: 'POST',
      body: { name: 'project-beta', dir: projBDir() },
    });
    assert.equal(resB.status, 201, 'Setup: project-beta should register');
    projBId = resB.body.id;
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Validates UI_FLOW.md § Dashboard — project list on load ──

  describe('Project list (GET /api/projects)', () => {
    it('should return all registered projects with task summaries', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.registered));
      assert.ok(body.registered.length >= 2, `Expected at least 2 projects, got ${body.registered.length}`);

      // Find project-alpha by name
      const alpha = body.registered.find((p: any) => p.name === 'project-alpha');
      assert.ok(alpha, 'project-alpha should be in the list');
      assert.ok(alpha.id, 'Project should have an id');
      assert.ok(alpha.dir, 'Project should have a dir');
      assert.ok(alpha.taskFile, 'Project should have a taskFile');
    });

    it('should include taskSummary with correct counts for each project', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);

      // project-alpha has MIXED_TASK_FILE: 1 completed, 1 remaining, 1 skipped
      const alpha = body.registered.find((p: any) => p.name === 'project-alpha');
      assert.ok(alpha.taskSummary, 'Should have taskSummary');
      assert.equal(alpha.taskSummary.total, 3, 'Should count 3 total tasks');
      assert.equal(alpha.taskSummary.completed, 1, 'Should count 1 completed');
      assert.equal(alpha.taskSummary.skipped, 1, 'Should count 1 skipped');
      assert.equal(alpha.taskSummary.remaining, 1, 'Should count 1 remaining');

      // project-beta has TASK_FILE_CONTENT: 2 unchecked
      const beta = body.registered.find((p: any) => p.name === 'project-beta');
      assert.ok(beta.taskSummary);
      assert.equal(beta.taskSummary.total, 2, 'Should count 2 total tasks');
      assert.equal(beta.taskSummary.completed, 0, 'Should count 0 completed');
      assert.equal(beta.taskSummary.remaining, 2, 'Should count 2 remaining');
    });

    it('should include activeSession as null when no active session exists', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);

      const beta = body.registered.find((p: any) => p.name === 'project-beta');
      assert.equal(beta.activeSession, null, 'Should have null activeSession when none running');
    });

    it('should include activeSession info when a session is running', async () => {
      // Pre-create a running session for project-alpha
      const activeId = randomUUID();
      preCreateSession({
        id: activeId,
        projectId: projAId,
        type: 'task-run',
        state: 'running',
      });

      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);

      const alpha = body.registered.find((p: any) => p.name === 'project-alpha');
      assert.ok(alpha.activeSession, 'Should have activeSession');
      assert.equal(alpha.activeSession.id, activeId);
      assert.equal(alpha.activeSession.type, 'task-run');
      assert.equal(alpha.activeSession.state, 'running');
      assert.ok(alpha.activeSession.startedAt, 'activeSession should have startedAt');

      // Clean up: mark as failed
      const metaPath = join(dataDir, 'sessions', activeId, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return response with registered array', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.registered));
    });
  });

  // ── Validates UI_FLOW.md § Project Detail — full project info ──

  describe('Project detail (GET /api/projects/:id)', () => {
    it('should return project with tasks, sessions, taskSummary, and activeSession', async () => {
      const { status, body } = await api(`/api/projects/${projAId}`);
      assert.equal(status, 200);
      assert.equal(body.id, projAId);
      assert.equal(body.name, 'project-alpha');
      assert.ok(body.dir, 'Should have dir');
      assert.ok(body.taskFile, 'Should have taskFile');

      // taskSummary
      assert.ok(body.taskSummary, 'Should have taskSummary');
      assert.equal(typeof body.taskSummary.total, 'number');
      assert.equal(typeof body.taskSummary.completed, 'number');
      assert.equal(typeof body.taskSummary.remaining, 'number');

      // tasks array
      assert.ok(Array.isArray(body.tasks), 'Should have tasks array');

      // sessions array
      assert.ok(Array.isArray(body.sessions), 'Should have sessions array');
    });

    it('should return correct task details parsed from task file', async () => {
      const { status, body } = await api(`/api/projects/${projAId}`);
      assert.equal(status, 200);

      // MIXED_TASK_FILE has 3 tasks
      assert.equal(body.tasks.length, 3, 'Should have 3 tasks from MIXED_TASK_FILE');
      assert.equal(body.taskSummary.total, 3);
      assert.equal(body.taskSummary.completed, 1);
      assert.equal(body.taskSummary.skipped, 1);
      assert.equal(body.taskSummary.remaining, 1);
    });

    it('should include sessions sorted most recent first', async () => {
      // Pre-create two sessions with different timestamps for project-beta
      const olderSessionId = randomUUID();
      const newerSessionId = randomUUID();

      preCreateSession({
        id: olderSessionId,
        projectId: projBId,
        type: 'task-run',
        state: 'completed',
        exitCode: 0,
        startedAt: '2026-03-22T10:00:00.000Z',
      });

      preCreateSession({
        id: newerSessionId,
        projectId: projBId,
        type: 'interview',
        state: 'completed',
        exitCode: 0,
        startedAt: '2026-03-23T10:00:00.000Z',
      });

      const { status, body } = await api(`/api/projects/${projBId}`);
      assert.equal(status, 200);
      assert.ok(body.sessions.length >= 2, 'Should have at least 2 sessions');

      // Verify sort order (most recent first)
      const first = new Date(body.sessions[0].startedAt).getTime();
      const second = new Date(body.sessions[1].startedAt).getTime();
      assert.ok(first >= second, 'Sessions should be sorted most recent first');
    });

    it('should return activeSession when a session is running for the project', async () => {
      // Pre-create a running session for project-beta
      const activeId = randomUUID();
      preCreateSession({
        id: activeId,
        projectId: projBId,
        type: 'task-run',
        state: 'running',
      });

      const { status, body } = await api(`/api/projects/${projBId}`);
      assert.equal(status, 200);
      assert.ok(body.activeSession, 'Should have activeSession');
      assert.equal(body.activeSession.id, activeId);
      assert.equal(body.activeSession.state, 'running');

      // Clean up
      const metaPath = join(dataDir, 'sessions', activeId, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return activeSession for waiting-for-input state', async () => {
      const waitId = randomUUID();
      preCreateSession({
        id: waitId,
        projectId: projAId,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Which database?',
      });

      const { status, body } = await api(`/api/projects/${projAId}`);
      assert.equal(status, 200);
      assert.ok(body.activeSession, 'waiting-for-input should count as active');
      assert.equal(body.activeSession.id, waitId);
      assert.equal(body.activeSession.state, 'waiting-for-input');

      // Clean up
      const metaPath = join(dataDir, 'sessions', waitId, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return null activeSession when all sessions are completed or failed', async () => {
      // Create a fresh project with only completed sessions
      const freshDir = join(projectsDir, 'detail-no-active');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'detail-no-active', dir: freshDir },
      });
      assert.equal(projRes.status, 201);

      preCreateSession({
        id: randomUUID(),
        projectId: projRes.body.id,
        type: 'task-run',
        state: 'completed',
        exitCode: 0,
      });

      const { status, body } = await api(`/api/projects/${projRes.body.id}`);
      assert.equal(status, 200);
      assert.equal(body.activeSession, null, 'Should have null activeSession');
    });

    it('should return 404 for non-existent project ID', async () => {
      const { status, body } = await api('/api/projects/nonexistent-uuid');
      assert.equal(status, 404);
      assert.equal(body.error, 'Project not found');
    });

    it('should handle project with empty task file gracefully', async () => {
      // Register a project dir with an empty tasks.md (no parseable tasks)
      const emptyTaskDir = join(projectsDir, 'empty-tasks');
      mkdirSync(emptyTaskDir, { recursive: true });
      writeFileSync(join(emptyTaskDir, 'tasks.md'), '# Tasks\n\nNo tasks yet.\n');

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'empty-tasks', dir: emptyTaskDir },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}`);
      assert.equal(status, 200);
      // Should fallback to empty/zero summary
      assert.equal(body.taskSummary.total, 0);
      assert.ok(Array.isArray(body.tasks));
      assert.equal(body.tasks.length, 0);
    });
  });

  // ── Validates UI_FLOW.md § API Endpoint Summary — project registration ──

  describe('Project registration (POST /api/projects)', () => {
    it('should register a new project and return 201 with project data', async () => {
      const regDir = join(projectsDir, 'register-test');
      mkdirSync(regDir, { recursive: true });
      writeFileSync(join(regDir, 'tasks.md'), TASK_FILE_CONTENT);

      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'register-test', dir: regDir },
      });
      assert.equal(status, 201);
      assert.ok(body.id, 'Should have a project id');
      assert.equal(body.name, 'register-test');
      assert.equal(body.dir, regDir);
    });

    it('should return 400 when name is missing', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { dir: '/some/path' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 when dir is missing', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'no-dir' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 409 when registering a duplicate project name', async () => {
      const dupDir = join(projectsDir, 'dup-register');
      mkdirSync(dupDir, { recursive: true });
      writeFileSync(join(dupDir, 'tasks.md'), TASK_FILE_CONTENT);

      const first = await api('/api/projects', {
        method: 'POST',
        body: { name: 'dup-register', dir: dupDir },
      });
      assert.equal(first.status, 201);

      const second = await api('/api/projects', {
        method: 'POST',
        body: { name: 'dup-register', dir: dupDir },
      });
      assert.equal(second.status, 409);
      assert.ok(second.body.error.includes('already registered'));
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await globalThis.fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });
      assert.equal(res.status, 400);
    });
  });

  // ── Validates UI_FLOW.md § API Endpoint Summary — project deletion ──

  describe('Project deletion (DELETE /api/projects/:id)', () => {
    it('should delete a project with no active sessions and return 204', async () => {
      const delDir = join(projectsDir, 'delete-test');
      mkdirSync(delDir, { recursive: true });
      writeFileSync(join(delDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'delete-test', dir: delDir },
      });
      assert.equal(projRes.status, 201);

      const { status } = await api(`/api/projects/${projRes.body.id}`, {
        method: 'DELETE',
      });
      assert.equal(status, 204);

      // Verify it's gone
      const getRes = await api(`/api/projects/${projRes.body.id}`);
      assert.equal(getRes.status, 404);
    });

    it('should return 409 when trying to delete a project with an active session', async () => {
      const activeDelDir = join(projectsDir, 'delete-active');
      mkdirSync(activeDelDir, { recursive: true });
      writeFileSync(join(activeDelDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'delete-active', dir: activeDelDir },
      });
      assert.equal(projRes.status, 201);

      // Pre-create an active session
      const activeSessionId = randomUUID();
      preCreateSession({
        id: activeSessionId,
        projectId: projRes.body.id,
        type: 'task-run',
        state: 'running',
      });

      const { status, body } = await api(`/api/projects/${projRes.body.id}`, {
        method: 'DELETE',
      });
      assert.equal(status, 409);
      assert.ok(body.error.includes('active session'));

      // Clean up active session
      const metaPath = join(dataDir, 'sessions', activeSessionId, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return 404 when deleting a non-existent project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-uuid', {
        method: 'DELETE',
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── Validates UI_FLOW.md § Dashboard — WebSocket dashboard updates ──

  describe('WebSocket dashboard stream (/ws/dashboard)', () => {
    it('should accept a WebSocket connection and receive project-update on workflow start', async () => {
      // Dynamic import for ws (ESM-compatible)
      const { default: WebSocket } = await import('ws');

      const ws = new WebSocket(`${wsBaseUrl}/ws/dashboard`);

      const messages: any[] = [];
      const connected = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      ws.on('message', (data: Buffer) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch { /* ignore non-JSON */ }
      });

      await connected;

      // Trigger a workflow that will broadcast project-update to dashboard
      const wfDir = join(projectsDir, 'ws-dash-test');
      mkdirSync(wfDir, { recursive: true });
      writeFileSync(join(wfDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'ws-dash-test', dir: wfDir },
      });
      assert.equal(projRes.status, 201);

      // Onboard a new project which broadcasts project-update messages
      const onboardDir = join(projectsDir, 'ws-workflow-trigger');
      mkdirSync(onboardDir, { recursive: true });
      const wfRes = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'ws-workflow-trigger', path: onboardDir },
      });
      assert.ok([200, 201].includes(wfRes.status), `Expected 200/201, got ${wfRes.status}: ${JSON.stringify(wfRes.body)}`);

      // Wait briefly for async workflow to broadcast
      await new Promise(r => setTimeout(r, 1500));

      ws.close();

      // We should have received at least one onboarding-step message from the onboard pipeline
      const onboardingSteps = messages.filter(m => m.type === 'onboarding-step');
      assert.ok(
        onboardingSteps.length >= 1,
        `Expected at least 1 onboarding-step message, got ${onboardingSteps.length}: ${JSON.stringify(messages)}`,
      );

      // Verify message shape
      const update = onboardingSteps[0];
      assert.equal(update.type, 'onboarding-step');
      assert.ok(update.projectId, 'Should have projectId');
      assert.ok(update.step, 'Should have step field');
      assert.ok(update.status, 'Should have status field');
    });

    it('should handle multiple concurrent dashboard WebSocket connections', async () => {
      const { default: WebSocket } = await import('ws');

      const ws1 = new WebSocket(`${wsBaseUrl}/ws/dashboard`);
      const ws2 = new WebSocket(`${wsBaseUrl}/ws/dashboard`);

      const connect = (ws: InstanceType<typeof WebSocket>) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
          ws.on('open', () => { clearTimeout(timeout); resolve(); });
          ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
        });

      await Promise.all([connect(ws1), connect(ws2)]);

      // Both should be connected
      assert.equal(ws1.readyState, 1, 'ws1 should be OPEN');
      assert.equal(ws2.readyState, 1, 'ws2 should be OPEN');

      ws1.close();
      ws2.close();
    });

    it('should gracefully handle WebSocket close and not crash the server', async () => {
      const { default: WebSocket } = await import('ws');

      const ws = new WebSocket(`${wsBaseUrl}/ws/dashboard`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
        ws.on('open', () => { clearTimeout(timeout); resolve(); });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      ws.close();

      // Wait for close to propagate
      await new Promise(r => setTimeout(r, 200));

      // Server should still be healthy
      const { status } = await api('/api/health');
      assert.equal(status, 200, 'Server should still be healthy after WS close');
    });
  });

  // ── Validates UI_FLOW.md § Dashboard — project list reflects session changes ──

  describe('Dashboard reflects session state changes', () => {
    it('should show updated activeSession after starting a real session', async () => {
      const liveDir = join(projectsDir, 'dash-live');
      mkdirSync(liveDir, { recursive: true });
      writeFileSync(join(liveDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'dash-live', dir: liveDir },
      });
      assert.equal(projRes.status, 201);
      const projId = projRes.body.id;

      // Before starting a session — no active session
      const before = await api(`/api/projects/${projId}`);
      assert.equal(before.body.activeSession, null);

      // Start a session
      const sessionRes = await api(`/api/projects/${projId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(sessionRes.status, 201);

      // Now the project detail should show active session
      const during = await api(`/api/projects/${projId}`);
      assert.ok(during.body.activeSession, 'Should have activeSession after starting');
      assert.equal(during.body.activeSession.id, sessionRes.body.id);
      assert.equal(during.body.activeSession.state, 'running');

      // Stop the session
      await api(`/api/sessions/${sessionRes.body.id}/stop`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 200));

      // After stopping — no active session
      const afterStop = await api(`/api/projects/${projId}`);
      assert.equal(afterStop.body.activeSession, null, 'Should have null activeSession after stop');
    });
  });
});
