/**
 * Integration Tests: Session Lifecycle
 *
 * Validates the full session lifecycle through API endpoints:
 * - Create session (POST /api/projects/:id/sessions)
 * - Get session details (GET /api/sessions/:id)
 * - List sessions (GET /api/projects/:id/sessions)
 * - Stop session (POST /api/sessions/:id/stop)
 * - Submit input (POST /api/sessions/:id/input)
 * - Session log retrieval (GET /api/sessions/:id/log)
 * - Concurrent session prevention (409)
 *
 * Validates UI_FLOW.md § Session View, § Session State Machine,
 * and § API Sequence Diagrams — Session Lifecycle
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

const ALL_DONE_TASK_FILE = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 First task
- [x] 1.2 Second task
`;

const BLOCKED_TASK_FILE = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 First task
- [?] 1.2 Second task — Blocked: Which database should we use?
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;

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

/** Wait for a condition to be true, polling at intervals */
async function waitFor(
  fn: () => Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 200 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
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
  logEntries?: Array<{ ts: number; stream: string; seq: number; content: string }>;
}): void {
  const sessionPath = join(dataDir, 'sessions', opts.id);
  mkdirSync(sessionPath, { recursive: true });

  const meta = {
    id: opts.id,
    projectId: opts.projectId,
    type: opts.type,
    state: opts.state,
    startedAt: new Date().toISOString(),
    endedAt: opts.state === 'completed' || opts.state === 'failed' ? new Date().toISOString() : null,
    pid: opts.state === 'running' ? 99999 : null,
    lastTaskId: null,
    question: opts.question ?? null,
    exitCode: opts.exitCode ?? null,
  };
  writeFileSync(join(sessionPath, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  if (opts.logEntries) {
    const lines = opts.logEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(join(sessionPath, 'output.jsonl'), lines);
  } else {
    writeFileSync(join(sessionPath, 'output.jsonl'), '');
  }
}

describe('Session Lifecycle Integration Tests', () => {
  // Pre-created session IDs
  const completedSessionId = randomUUID();
  const waitingSessionId = randomUUID();
  const failedSessionId = randomUUID();

  // Project IDs set during setup
  let mainProjectId: string;
  let mainProjectDir: string;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-lifecycle-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mainProjectDir = join(projectsDir, 'lifecycle-test');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(mainProjectDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');
    writeFileSync(join(mainProjectDir, 'tasks.md'), TASK_FILE_CONTENT);

    baseUrl = `http://127.0.0.1:${PORT}`;
    await startServer();

    // Register main project
    const projRes = await api('/api/projects', {
      method: 'POST',
      body: { name: 'lifecycle-test', dir: mainProjectDir },
    });
    assert.equal(projRes.status, 201, 'Setup: main project should be created');
    mainProjectId = projRes.body.id;

    // Pre-create sessions in various states for read-only tests
    preCreateSession({
      id: completedSessionId,
      projectId: mainProjectId,
      type: 'task-run',
      state: 'completed',
      exitCode: 0,
      logEntries: [
        { ts: 1711100000000, stream: 'system', seq: 1, content: 'Session started' },
        { ts: 1711100001000, stream: 'stdout', seq: 2, content: 'Working on task 1.1...' },
        { ts: 1711100002000, stream: 'stderr', seq: 3, content: 'Warning: deprecated API' },
        { ts: 1711100003000, stream: 'stdout', seq: 4, content: 'Task 1.1 completed' },
        { ts: 1711100004000, stream: 'system', seq: 5, content: 'All tasks completed' },
      ],
    });

    preCreateSession({
      id: failedSessionId,
      projectId: mainProjectId,
      type: 'interview',
      state: 'failed',
      exitCode: 1,
      logEntries: [
        { ts: 1711100000000, stream: 'system', seq: 1, content: 'Session started' },
        { ts: 1711100001000, stream: 'stderr', seq: 2, content: 'Error: process crashed' },
      ],
    });
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Validates UI_FLOW.md § Session View — session creation ──

  describe('Session creation (POST /api/projects/:id/sessions)', () => {
    it('should create a task-run session and return 201 with running state', async () => {
      // Use a fresh project to avoid active session conflicts
      const freshDir = join(projectsDir, 'create-taskrun');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'create-taskrun', dir: freshDir },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.id, 'Should have session id');
      assert.equal(body.projectId, projRes.body.id);
      assert.equal(body.type, 'task-run');
      assert.equal(body.state, 'running');
      assert.ok(body.startedAt, 'Should have startedAt');
    });

    it('should create an interview session and return 201 with running state', async () => {
      const freshDir = join(projectsDir, 'create-interview');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'create-interview', dir: freshDir },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'interview', allowUnsandboxed: true },
      });
      assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.id);
      assert.equal(body.type, 'interview');
      assert.equal(body.state, 'running');
      assert.ok(body.pid, 'Interview session should have a pid');
    });

    it('should return 400 for invalid session type', async () => {
      const { status, body } = await api(`/api/projects/${mainProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'invalid-type' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 for missing type field', async () => {
      const { status, body } = await api(`/api/projects/${mainProjectId}/sessions`, {
        method: 'POST',
        body: {},
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await globalThis.fetch(`${baseUrl}/api/projects/${mainProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });
      assert.equal(res.status, 400);
    });

    it('should return 404 for non-existent project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-id/sessions', {
        method: 'POST',
        body: { type: 'task-run' },
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 400 for task-run when no unchecked tasks remain', async () => {
      const doneDir = join(projectsDir, 'all-done');
      mkdirSync(doneDir, { recursive: true });
      writeFileSync(join(doneDir, 'tasks.md'), ALL_DONE_TASK_FILE);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'all-done', dir: doneDir },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'No unchecked tasks remaining');
    });
  });

  // ── Validates UI_FLOW.md § Session State Machine — concurrent session prevention ──

  describe('Concurrent session prevention', () => {
    it('should return 409 when project already has an active session', async () => {
      // Pre-create a running session for the main project
      const activeSessionId = randomUUID();
      preCreateSession({
        id: activeSessionId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'running',
      });

      const { status, body } = await api(`/api/projects/${mainProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.error);
      assert.ok(body.error.includes('already has an active session'));

      // Clean up: mark the pre-created session as failed so other tests aren't affected
      const sessionPath = join(dataDir, 'sessions', activeSessionId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.exitCode = -1;
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should allow creating a session when waiting-for-input session exists (it counts as active)', async () => {
      // Pre-create a waiting-for-input session — this IS active
      const waitActiveId = randomUUID();
      preCreateSession({
        id: waitActiveId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Pending question',
      });

      const { status, body } = await api(`/api/projects/${mainProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.error.includes('already has an active session'));

      // Clean up
      const sessionPath = join(dataDir, 'sessions', waitActiveId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should allow creating a session after previous session completed', async () => {
      // Main project only has completed and failed sessions now
      // Create a fresh project to avoid interference
      const freshDir = join(projectsDir, 'after-complete');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'after-complete', dir: freshDir },
      });
      assert.equal(projRes.status, 201);
      const projId = projRes.body.id;

      // Pre-create a completed session for this project
      preCreateSession({
        id: randomUUID(),
        projectId: projId,
        type: 'task-run',
        state: 'completed',
        exitCode: 0,
      });

      // Should be able to create a new session
      const { status, body } = await api(`/api/projects/${projId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.state, 'running');
    });
  });

  // ── Validates UI_FLOW.md § Session View — get session details ──

  describe('Get session details (GET /api/sessions/:id)', () => {
    it('should return completed session with all fields', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}`);
      assert.equal(status, 200);
      assert.equal(body.id, completedSessionId);
      assert.equal(body.projectId, mainProjectId);
      assert.equal(body.type, 'task-run');
      assert.equal(body.state, 'completed');
      assert.ok(body.startedAt, 'Should have startedAt');
      assert.ok(body.endedAt, 'Should have endedAt for completed session');
      assert.equal(body.exitCode, 0, 'Completed session should have exitCode 0');
      assert.equal(body.pid, null, 'Completed session should have null pid');
    });

    it('should return failed session with exitCode', async () => {
      const { status, body } = await api(`/api/sessions/${failedSessionId}`);
      assert.equal(status, 200);
      assert.equal(body.state, 'failed');
      assert.equal(body.exitCode, 1);
      assert.ok(body.endedAt);
    });

    it('should return 404 for non-existent session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-session-id');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── Validates UI_FLOW.md § Project Detail — list sessions ──

  describe('List sessions (GET /api/projects/:id/sessions)', () => {
    it('should return sessions for a project sorted most recent first', async () => {
      const { status, body } = await api(`/api/projects/${mainProjectId}/sessions`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      // We pre-created at least completedSessionId and failedSessionId
      assert.ok(body.length >= 2, `Expected at least 2 sessions, got ${body.length}`);

      // Verify session shape
      const session = body[0];
      assert.ok(session.id);
      assert.ok(['task-run', 'interview'].includes(session.type));
      assert.ok(['running', 'waiting-for-input', 'completed', 'failed'].includes(session.state));
      assert.ok(session.startedAt);

      // Verify sort order (most recent first)
      if (body.length >= 2) {
        const first = new Date(body[0].startedAt).getTime();
        const second = new Date(body[1].startedAt).getTime();
        assert.ok(first >= second, 'Sessions should be sorted most recent first');
      }
    });

    it('should return empty array for project with no sessions', async () => {
      const emptyDir = join(projectsDir, 'no-sessions');
      mkdirSync(emptyDir, { recursive: true });
      writeFileSync(join(emptyDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'no-sessions', dir: emptyDir },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}/sessions`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 0);
    });

    it('should return 404 for non-existent project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-id/sessions');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── Validates UI_FLOW.md § Session State Machine — stop flow ──

  describe('Stop session (POST /api/sessions/:id/stop)', () => {
    it('should stop a running session and return failed state with exitCode -1', async () => {
      const stopDir = join(projectsDir, 'stop-lifecycle');
      mkdirSync(stopDir, { recursive: true });
      writeFileSync(join(stopDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-lifecycle', dir: stopDir },
      });
      assert.equal(projRes.status, 201);

      const sessionRes = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(sessionRes.status, 201);

      // Stop the session immediately
      const { status, body } = await api(`/api/sessions/${sessionRes.body.id}/stop`, {
        method: 'POST',
      });
      assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.state, 'failed');
      assert.equal(body.exitCode, -1, 'Manual stop should have exitCode -1');
      assert.ok(body.endedAt, 'Should have endedAt timestamp');
      assert.equal(body.id, sessionRes.body.id);
    });

    it('should persist stopped state — GET after stop returns failed', async () => {
      const stopDir2 = join(projectsDir, 'stop-persist');
      mkdirSync(stopDir2, { recursive: true });
      writeFileSync(join(stopDir2, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-persist', dir: stopDir2 },
      });
      assert.equal(projRes.status, 201);

      const sessionRes = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(sessionRes.status, 201);
      const sessionId = sessionRes.body.id;

      await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });

      // Verify via GET
      const { status, body } = await api(`/api/sessions/${sessionId}`);
      assert.equal(status, 200);
      assert.equal(body.state, 'failed');
      assert.equal(body.exitCode, -1);
      assert.ok(body.endedAt);
    });

    it('should return 400 when stopping a completed session', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/stop`, {
        method: 'POST',
      });
      assert.equal(status, 400);
      assert.ok(body.error.includes('not in running state'));
    });

    it('should return 400 when stopping a failed session', async () => {
      const { status, body } = await api(`/api/sessions/${failedSessionId}/stop`, {
        method: 'POST',
      });
      assert.equal(status, 400);
      assert.ok(body.error.includes('not in running state'));
    });

    it('should return 404 for non-existent session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-id/stop', {
        method: 'POST',
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should allow creating a new session after stopping', async () => {
      const restartDir = join(projectsDir, 'stop-restart');
      mkdirSync(restartDir, { recursive: true });
      writeFileSync(join(restartDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-restart', dir: restartDir },
      });
      assert.equal(projRes.status, 201);
      const projId = projRes.body.id;

      // Create and stop first session
      const session1 = await api(`/api/projects/${projId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(session1.status, 201);
      await api(`/api/sessions/${session1.body.id}/stop`, { method: 'POST' });

      // Wait briefly for state to settle
      await new Promise(r => setTimeout(r, 200));

      // Create second session — should succeed
      const session2 = await api(`/api/projects/${projId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(session2.status, 201, `Expected 201, got ${session2.status}: ${JSON.stringify(session2.body)}`);
      assert.notEqual(session2.body.id, session1.body.id, 'New session should have different ID');

      // Cleanup
      await api(`/api/sessions/${session2.body.id}/stop`, { method: 'POST' });
    });
  });

  // ── Validates UI_FLOW.md § Session State Machine — input/blocked flow ──

  describe('Submit input (POST /api/sessions/:id/input)', () => {
    it('should transition waiting-for-input session to running on valid input', async () => {
      // Pre-create a waiting-for-input session with a valid project
      const inputDir = join(projectsDir, 'input-test');
      mkdirSync(inputDir, { recursive: true });
      writeFileSync(join(inputDir, 'tasks.md'), BLOCKED_TASK_FILE);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'input-test', dir: inputDir },
      });
      assert.equal(projRes.status, 201);

      const inputSessionId = randomUUID();
      preCreateSession({
        id: inputSessionId,
        projectId: projRes.body.id,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Which database should we use?',
      });

      const { status, body } = await api(`/api/sessions/${inputSessionId}/input`, {
        method: 'POST',
        body: { answer: 'Use PostgreSQL' },
      });
      assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.id, inputSessionId);
      assert.equal(body.state, 'running');
      assert.ok(body.startedAt);
    });

    it('should return 400 when submitting input to a running session', async () => {
      // Pre-create a running session
      const runningForInputId = randomUUID();
      preCreateSession({
        id: runningForInputId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'running',
      });

      const { status, body } = await api(`/api/sessions/${runningForInputId}/input`, {
        method: 'POST',
        body: { answer: 'Some answer' },
      });
      assert.equal(status, 400);
      assert.ok(body.error.includes('not in waiting-for-input state'));

      // Clean up
      const sessionPath = join(dataDir, 'sessions', runningForInputId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return 400 when submitting input to a completed session', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/input`, {
        method: 'POST',
        body: { answer: 'Some answer' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 when answer is empty', async () => {
      const emptyAnswerId = randomUUID();
      preCreateSession({
        id: emptyAnswerId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Need input',
      });

      const { status, body } = await api(`/api/sessions/${emptyAnswerId}/input`, {
        method: 'POST',
        body: { answer: '' },
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Empty answer');

      // Clean up
      const sessionPath = join(dataDir, 'sessions', emptyAnswerId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return 400 when answer is only whitespace', async () => {
      const wsAnswerId = randomUUID();
      preCreateSession({
        id: wsAnswerId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Need input',
      });

      const { status, body } = await api(`/api/sessions/${wsAnswerId}/input`, {
        method: 'POST',
        body: { answer: '   ' },
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Empty answer');

      // Clean up
      const sessionPath = join(dataDir, 'sessions', wsAnswerId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return 400 for invalid JSON body', async () => {
      const badJsonId = randomUUID();
      preCreateSession({
        id: badJsonId,
        projectId: mainProjectId,
        type: 'task-run',
        state: 'waiting-for-input',
        question: 'Need input',
      });

      const res = await globalThis.fetch(`${baseUrl}/api/sessions/${badJsonId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });
      assert.equal(res.status, 400);

      // Clean up
      const sessionPath = join(dataDir, 'sessions', badJsonId, 'meta.json');
      const meta = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      meta.state = 'failed';
      meta.endedAt = new Date().toISOString();
      meta.pid = null;
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2) + '\n');
    });

    it('should return 404 for non-existent session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-id/input', {
        method: 'POST',
        body: { answer: 'test' },
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── Validates UI_FLOW.md § Session View — log retrieval ──

  describe('Session log retrieval (GET /api/sessions/:id/log)', () => {
    it('should return full log as JSON array', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/log`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 5, 'Should have 5 log entries');

      // Verify entry structure
      const entry = body[0];
      assert.equal(typeof entry.ts, 'number');
      assert.ok(['stdout', 'stderr', 'system'].includes(entry.stream));
      assert.equal(typeof entry.seq, 'number');
      assert.equal(typeof entry.content, 'string');
    });

    it('should filter entries with afterSeq parameter', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/log?afterSeq=3`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 2, 'Should return entries with seq > 3');
      assert.ok(body.every((e: any) => e.seq > 3), 'All entries should have seq > 3');
    });

    it('should return empty array when afterSeq is beyond last entry', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/log?afterSeq=100`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 0);
    });

    it('should return empty array for session with no log entries', async () => {
      const emptyLogId = randomUUID();
      preCreateSession({
        id: emptyLogId,
        projectId: mainProjectId,
        type: 'interview',
        state: 'completed',
        exitCode: 0,
      });

      const { status, body } = await api(`/api/sessions/${emptyLogId}/log`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 0);
    });

    it('should return 404 for non-existent session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-id/log');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── Validates UI_FLOW.md § Session State Machine — process exit transitions ──

  describe('Session state transitions on process exit', () => {
    it('should transition to failed when spawned process exits with non-zero code', async () => {
      // Create a real session — the spawned process (nix develop... claude)
      // will fail because the project dir has no flake.nix, producing a non-zero exit
      const failDir = join(projectsDir, 'exit-fail');
      mkdirSync(failDir, { recursive: true });
      writeFileSync(join(failDir, 'tasks.md'), TASK_FILE_CONTENT);

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'exit-fail', dir: failDir },
      });
      assert.equal(projRes.status, 201);

      const sessionRes = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(sessionRes.status, 201);
      const sessionId = sessionRes.body.id;

      // Wait for the process to fail and state to transition
      await waitFor(async () => {
        const { body } = await api(`/api/sessions/${sessionId}`);
        return body.state === 'failed' || body.state === 'completed';
      }, { timeoutMs: 15000, intervalMs: 500 });

      const { body } = await api(`/api/sessions/${sessionId}`);
      assert.equal(body.state, 'failed', 'Session should transition to failed on process crash');
      assert.ok(body.endedAt, 'Should have endedAt');
      assert.notEqual(body.exitCode, 0, 'Exit code should be non-zero');
    });
  });
});
