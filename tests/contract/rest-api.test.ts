/**
 * Comprehensive REST API Contract Tests
 *
 * Validates ALL REST API endpoints against rest-api.md contracts,
 * running against a live server instance.
 *
 * Endpoints covered:
 *  1. GET    /api/health
 *  2. PUT    /api/config/log-level
 *  3. GET    /api/projects
 *  4. POST   /api/projects
 *  5. GET    /api/projects/:id
 *  6. DELETE /api/projects/:id
 *  7. POST   /api/projects/:id/sessions
 *  8. GET    /api/projects/:id/sessions
 *  9. GET    /api/sessions/:id
 * 10. POST   /api/sessions/:id/stop
 * 11. POST   /api/sessions/:id/input
 * 12. GET    /api/sessions/:id/log
 * 13. POST   /api/push/subscribe
 * 14. GET    /api/push/vapid-key
 * 15. POST   /api/voice/transcribe
 * 16. POST   /api/projects/:id/add-feature
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TASK_FILE_CONTENT = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 Initialize project
- [ ] 1.2 Configure TypeScript
- [~] 1.3 Optional step — Skipped: not needed

## Phase 2: Core

- [?] 2.1 Implement feature — Blocked: Which API to use?
- [ ] 2.2 Write tests
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let projectDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;
let registeredProjectId: string;

const PORT = 30000 + Math.floor(Math.random() * 10000);

async function api(
  path: string,
  options: { method?: string; body?: unknown; rawBody?: Buffer; contentType?: string } = {},
): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let reqBody: string | Buffer | undefined;

  if (options.rawBody) {
    headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
    reqBody = options.rawBody;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(options.body);
  }

  const res = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: reqBody,
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
 * This bypasses process spawning for tests that just need session data to exist.
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

function buildMultipartBody(
  boundary: string,
  fieldName: string,
  fileName: string,
  contentType: string,
  data: Buffer,
): Buffer {
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    '',
    '',
  ].join('\r\n');
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf-8'), data, Buffer.from(footer, 'utf-8')]);
}

describe('REST API: Full Contract Validation', () => {
  // IDs for pre-created sessions
  const completedSessionId = randomUUID();
  const waitingSessionId = randomUUID();
  const runningSessionId = randomUUID();

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'contract-full-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    projectDir = join(projectsDir, 'test-project');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');
    writeFileSync(join(projectDir, 'tasks.md'), TASK_FILE_CONTENT);

    baseUrl = `http://127.0.0.1:${PORT}`;
    await startServer();

    // Register a project for session tests
    const createRes = await api('/api/projects', {
      method: 'POST',
      body: { name: 'test-project', dir: projectDir },
    });
    assert.equal(createRes.status, 201, 'Setup: project should be created');
    registeredProjectId = createRes.body.id;

    // Pre-create sessions for GET/log/input/stop tests
    preCreateSession({
      id: completedSessionId,
      projectId: registeredProjectId,
      type: 'task-run',
      state: 'completed',
      exitCode: 0,
      logEntries: [
        { ts: 1711100000000, stream: 'system', seq: 1, content: 'Session started' },
        { ts: 1711100001000, stream: 'stdout', seq: 2, content: 'Working on task 1.1...' },
        { ts: 1711100002000, stream: 'stderr', seq: 3, content: 'Warning: deprecated API' },
        { ts: 1711100003000, stream: 'system', seq: 4, content: 'Session completed' },
      ],
    });

    preCreateSession({
      id: waitingSessionId,
      projectId: registeredProjectId,
      type: 'task-run',
      state: 'waiting-for-input',
      question: 'What API key should I use?',
    });
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. GET /api/health ──

  describe('GET /api/health', () => {
    it('should return 200 with status, uptime, sandboxAvailable, cloudSttAvailable', async () => {
      const { status, body } = await api('/api/health');
      assert.equal(status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(typeof body.uptime, 'number', 'uptime should be a number');
      assert.ok(body.uptime >= 0, 'uptime should be non-negative');
      assert.equal(typeof body.sandboxAvailable, 'boolean', 'sandboxAvailable should be boolean');
      assert.equal(typeof body.cloudSttAvailable, 'boolean', 'cloudSttAvailable should be boolean');
    });

    it('should report cloudSttAvailable as false when no GOOGLE_STT_API_KEY', async () => {
      const { body } = await api('/api/health');
      assert.equal(body.cloudSttAvailable, false);
    });
  });

  // ── 2. PUT /api/config/log-level ──

  describe('PUT /api/config/log-level', () => {
    it('should return 200 with updated level', async () => {
      const { status, body } = await api('/api/config/log-level', {
        method: 'PUT',
        body: { level: 'debug' },
      });
      assert.equal(status, 200);
      assert.equal(body.level, 'debug');
    });

    it('should accept all valid levels', async () => {
      for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
        const { status, body } = await api('/api/config/log-level', {
          method: 'PUT',
          body: { level },
        });
        assert.equal(status, 200, `Should accept level: ${level}`);
        assert.equal(body.level, level);
      }
    });

    it('should return 400 for invalid level', async () => {
      const { status, body } = await api('/api/config/log-level', {
        method: 'PUT',
        body: { level: 'verbose' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await globalThis.fetch(`${baseUrl}/api/config/log-level`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      assert.equal(res.status, 400);
    });

    // Restore to info for remaining tests
    after(async () => {
      await api('/api/config/log-level', { method: 'PUT', body: { level: 'info' } });
    });
  });

  // ── 3-6. Project CRUD ──

  describe('GET /api/projects', () => {
    it('should return 200 with array of projects including taskSummary and activeSession', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);

      const project = body.find((p: any) => p.id === registeredProjectId);
      assert.ok(project, 'Should contain registered project');
      assert.equal(project.name, 'test-project');
      assert.equal(project.dir, projectDir);
      assert.ok(project.createdAt);
      assert.ok(project.taskFile);

      // taskSummary per rest-api.md
      assert.ok(project.taskSummary);
      assert.equal(typeof project.taskSummary.total, 'number');
      assert.equal(typeof project.taskSummary.completed, 'number');
      assert.equal(typeof project.taskSummary.blocked, 'number');
      assert.equal(typeof project.taskSummary.skipped, 'number');
      assert.equal(typeof project.taskSummary.remaining, 'number');

      // activeSession field should be present (may be non-null due to pre-created sessions)
      assert.ok('activeSession' in project, 'Should have activeSession field');
    });
  });

  describe('POST /api/projects', () => {
    it('should return 201 with created project per rest-api.md contract', async () => {
      const newDir = join(projectsDir, 'new-project');
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(newDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');

      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'new-project', dir: newDir },
      });
      assert.equal(status, 201);
      assert.ok(body.id, 'Should have id');
      assert.equal(body.name, 'new-project');
      assert.equal(body.dir, newDir);
      assert.ok(body.createdAt, 'Should have createdAt');
      assert.ok(body.taskFile, 'Should have taskFile');
    });

    it('should return 400 for missing name', async () => {
      const { status } = await api('/api/projects', { method: 'POST', body: { dir: '/tmp' } });
      assert.equal(status, 400);
    });

    it('should return 400 for missing dir', async () => {
      const { status } = await api('/api/projects', { method: 'POST', body: { name: 'x' } });
      assert.equal(status, 400);
    });

    it('should return 400 for non-existent directory', async () => {
      const { status } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'ghost', dir: '/tmp/nonexistent-contract-test-99999' },
      });
      assert.equal(status, 400);
    });

    it('should return 400 when no tasks.md in directory', async () => {
      const emptyDir = join(projectsDir, 'empty-contract');
      mkdirSync(emptyDir, { recursive: true });
      const { status } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'empty', dir: emptyDir },
      });
      assert.equal(status, 400);
    });

    it('should return 409 for duplicate directory', async () => {
      const { status } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'dup', dir: projectDir },
      });
      assert.equal(status, 409);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return 200 with project detail, tasks[], sessions[], taskSummary, activeSession', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}`);
      assert.equal(status, 200);
      assert.equal(body.id, registeredProjectId);
      assert.equal(body.name, 'test-project');
      assert.equal(body.dir, projectDir);
      assert.ok(body.taskSummary);
      assert.ok(Array.isArray(body.tasks), 'Should have tasks array');
      assert.ok(body.tasks.length > 0);

      // Validate task structure per rest-api.md
      const task = body.tasks[0];
      assert.ok(task.id);
      assert.equal(typeof task.phase, 'number');
      assert.ok(task.phaseName);
      assert.ok(['unchecked', 'checked', 'blocked', 'skipped'].includes(task.status));
      assert.ok(task.description);
      assert.ok('blockedReason' in task);
      assert.equal(typeof task.depth, 'number');

      assert.ok(Array.isArray(body.sessions), 'Should have sessions array');
      assert.ok('activeSession' in body);
    });

    it('should return 404 for unknown project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-99999');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should return 204 on successful delete', async () => {
      const delDir = join(projectsDir, 'to-delete-full');
      mkdirSync(delDir, { recursive: true });
      writeFileSync(join(delDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');

      const createRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'to-delete', dir: delDir },
      });
      const { status } = await api(`/api/projects/${createRes.body.id}`, { method: 'DELETE' });
      assert.equal(status, 204);

      // Verify gone
      const getRes = await api(`/api/projects/${createRes.body.id}`);
      assert.equal(getRes.status, 404);
    });

    it('should return 404 for unknown project', async () => {
      const { status } = await api('/api/projects/nonexistent-99999', { method: 'DELETE' });
      assert.equal(status, 404);
    });
  });

  // ── 7. POST /api/projects/:id/sessions ──

  describe('POST /api/projects/:id/sessions', () => {
    it('should return 400 for invalid session type', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'invalid' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 404 for unknown project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-99999/sessions', {
        method: 'POST',
        body: { type: 'task-run' },
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 409 when project already has an active session', async () => {
      // Pre-created waitingSessionId is active (waiting-for-input) for registeredProjectId
      const { status, body } = await api(`/api/projects/${registeredProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.error);
    });

    it('should return 201 with session info for a valid request', async () => {
      // Register a fresh project with no active sessions
      const freshDir = join(projectsDir, 'fresh-session');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), '# Tasks\n\n## Phase 1: Setup\n\n- [ ] 1.1 A task\n');

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'fresh-session', dir: freshDir },
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
      assert.ok(body.startedAt);
    });
  });

  // ── 8. GET /api/projects/:id/sessions ──

  describe('GET /api/projects/:id/sessions', () => {
    it('should return 200 with array of sessions for the project', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}/sessions`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      // We pre-created sessions for this project
      assert.ok(body.length >= 2, `Expected at least 2 sessions, got ${body.length}`);

      const session = body[0];
      assert.ok(session.id);
      assert.ok(['task-run', 'interview'].includes(session.type));
      assert.ok(['running', 'waiting-for-input', 'completed', 'failed'].includes(session.state));
      assert.ok(session.startedAt);
    });

    it('should return sessions sorted most recent first', async () => {
      const { body } = await api(`/api/projects/${registeredProjectId}/sessions`);
      if (body.length >= 2) {
        const first = new Date(body[0].startedAt).getTime();
        const second = new Date(body[1].startedAt).getTime();
        assert.ok(first >= second, 'Sessions should be sorted most recent first');
      }
    });

    it('should return 404 for unknown project', async () => {
      const { status } = await api('/api/projects/nonexistent-99999/sessions');
      assert.equal(status, 404);
    });
  });

  // ── 9. GET /api/sessions/:id ──

  describe('GET /api/sessions/:id', () => {
    it('should return 200 with full session details for completed session', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}`);
      assert.equal(status, 200);
      assert.equal(body.id, completedSessionId);
      assert.equal(body.projectId, registeredProjectId);
      assert.equal(body.type, 'task-run');
      assert.equal(body.state, 'completed');
      assert.ok(body.startedAt);
      assert.ok(body.endedAt);
      assert.equal(body.exitCode, 0);
    });

    it('should return 200 with question for waiting-for-input session', async () => {
      const { status, body } = await api(`/api/sessions/${waitingSessionId}`);
      assert.equal(status, 200);
      assert.equal(body.state, 'waiting-for-input');
      assert.equal(body.question, 'What API key should I use?');
    });

    it('should return 404 for unknown session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-99999');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  // ── 10. POST /api/sessions/:id/stop ──

  describe('POST /api/sessions/:id/stop', () => {
    it('should return 400 when session is not in running state', async () => {
      // completedSessionId is in 'completed' state
      const { status, body } = await api(`/api/sessions/${completedSessionId}/stop`, { method: 'POST' });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 404 for unknown session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-99999/stop', { method: 'POST' });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 200 with failed state and exitCode -1 when stopping a running session', async () => {
      // Create a fresh project + running session to stop
      const stopDir = join(projectsDir, 'stop-test');
      mkdirSync(stopDir, { recursive: true });
      writeFileSync(join(stopDir, 'tasks.md'), '# Tasks\n\n## Phase 1: Setup\n\n- [ ] 1.1 A task\n');

      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-test', dir: stopDir },
      });
      assert.equal(projRes.status, 201);

      const sessionRes = await api(`/api/projects/${projRes.body.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(sessionRes.status, 201);

      const { status, body } = await api(`/api/sessions/${sessionRes.body.id}/stop`, { method: 'POST' });
      assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.state, 'failed');
      assert.equal(body.exitCode, -1);
      assert.ok(body.endedAt);
      assert.equal(body.id, sessionRes.body.id);
    });
  });

  // ── 11. POST /api/sessions/:id/input ──

  describe('POST /api/sessions/:id/input', () => {
    it('should return 400 when session is not in waiting-for-input state', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/input`, {
        method: 'POST',
        body: { answer: 'test answer' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 when answer is empty', async () => {
      const { status, body } = await api(`/api/sessions/${waitingSessionId}/input`, {
        method: 'POST',
        body: { answer: '' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 404 for unknown session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-99999/input', {
        method: 'POST',
        body: { answer: 'test' },
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 200 with running state when answering a waiting session', async () => {
      const { status, body } = await api(`/api/sessions/${waitingSessionId}/input`, {
        method: 'POST',
        body: { answer: 'Use the Stripe test key' },
      });
      assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.id, waitingSessionId);
      assert.equal(body.projectId, registeredProjectId);
      assert.equal(body.state, 'running');
      assert.ok(body.startedAt);
    });
  });

  // ── 12. GET /api/sessions/:id/log ──

  describe('GET /api/sessions/:id/log', () => {
    it('should return 200 with full log as JSON array', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/log`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body), 'Log should be a JSON array');
      assert.equal(body.length, 4, 'Should have 4 log entries');

      // Verify log entry structure per rest-api.md
      const entry = body[0];
      assert.equal(typeof entry.ts, 'number', 'ts should be a number');
      assert.ok(['stdout', 'stderr', 'system'].includes(entry.stream), 'stream should be valid');
      assert.equal(typeof entry.seq, 'number', 'seq should be a number');
      assert.equal(typeof entry.content, 'string', 'content should be a string');
    });

    it('should support afterSeq filter', async () => {
      const { status, body } = await api(`/api/sessions/${completedSessionId}/log?afterSeq=2`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      // Should only return entries with seq > 2 (seq 3 and 4)
      assert.equal(body.length, 2, 'Should return only entries after seq 2');
      assert.ok(body.every((e: any) => e.seq > 2), 'All entries should have seq > 2');
    });

    it('should return empty array for session with no log', async () => {
      // waitingSessionId has an empty log file
      const { status, body } = await api(`/api/sessions/${waitingSessionId}/log`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
    });

    it('should return 404 for unknown session', async () => {
      const { status } = await api('/api/sessions/nonexistent-99999/log');
      assert.equal(status, 404);
    });
  });

  // ── 13. POST /api/push/subscribe ──

  describe('POST /api/push/subscribe', () => {
    it('should return 201 when subscription is valid', async () => {
      const { status } = await api('/api/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: 'https://fcm.googleapis.com/test-endpoint',
          keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
        },
      });
      assert.equal(status, 201);
    });

    it('should return 400 when endpoint is missing', async () => {
      const { status, body } = await api('/api/push/subscribe', {
        method: 'POST',
        body: { keys: { p256dh: 'a', auth: 'b' } },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 when keys are missing', async () => {
      const { status, body } = await api('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'https://example.com' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });
  });

  // ── 14. GET /api/push/vapid-key ──

  describe('GET /api/push/vapid-key', () => {
    it('should return 200 with publicKey', async () => {
      const { status, body } = await api('/api/push/vapid-key');
      assert.equal(status, 200);
      assert.ok(body.publicKey, 'Should have publicKey field');
      assert.equal(typeof body.publicKey, 'string');
    });
  });

  // ── 15. POST /api/voice/transcribe ──

  describe('POST /api/voice/transcribe', () => {
    it('should return 400 when no audio provided', async () => {
      const { status, body } = await api('/api/voice/transcribe', {
        method: 'POST',
        body: {},
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 503 when GOOGLE_STT_API_KEY not configured', async () => {
      const audioData = Buffer.from('fake-audio-data');
      const boundary = '----FormBoundary' + Date.now();
      const multipartBody = buildMultipartBody(boundary, 'audio', 'audio.webm', 'audio/webm', audioData);

      const res = await globalThis.fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: multipartBody,
      });
      assert.equal(res.status, 503);
      const json = await res.json() as any;
      assert.ok(json.error);
    });

    it('should not return 404 (endpoint exists and is routed)', async () => {
      const { status } = await api('/api/voice/transcribe', {
        method: 'POST',
        body: {},
      });
      assert.notEqual(status, 404);
    });
  });

  // ── 16. POST /api/projects/:id/add-feature ──

  describe('POST /api/projects/:id/add-feature', () => {
    it('should return 404 for unknown project', async () => {
      const { status, body } = await api('/api/projects/nonexistent-99999/add-feature', {
        method: 'POST',
        body: { description: 'Add a feature' },
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 400 when description is empty', async () => {
      // Use a project that may have an active session — 400 should be checked before 409
      // Register a fresh project for this test
      const featDir = join(projectsDir, 'feat-empty-desc');
      mkdirSync(featDir, { recursive: true });
      writeFileSync(join(featDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');
      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'feat-empty-desc', dir: featDir },
      });

      const { status, body } = await api(`/api/projects/${projRes.body.id}/add-feature`, {
        method: 'POST',
        body: { description: '' },
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 400 when description is missing', async () => {
      const featDir2 = join(projectsDir, 'feat-no-desc');
      mkdirSync(featDir2, { recursive: true });
      writeFileSync(join(featDir2, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');
      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'feat-no-desc', dir: featDir2 },
      });

      const { status, body } = await api(`/api/projects/${projRes.body.id}/add-feature`, {
        method: 'POST',
        body: {},
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('should return 201 with session info for valid add-feature request', async () => {
      const featDir3 = join(projectsDir, 'feat-valid');
      mkdirSync(featDir3, { recursive: true });
      writeFileSync(join(featDir3, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');
      const projRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'feat-valid', dir: featDir3 },
      });
      assert.equal(projRes.status, 201);

      const { status, body } = await api(`/api/projects/${projRes.body.id}/add-feature`, {
        method: 'POST',
        body: { description: 'Add user authentication' },
      });
      assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.sessionId);
      assert.equal(body.projectId, projRes.body.id);
      assert.equal(body.phase, 'specify');
      assert.equal(body.state, 'running');
    });
  });

  // ── Unknown endpoint ──

  describe('Unknown API endpoint', () => {
    it('should return 404 for unknown paths', async () => {
      const { status, body } = await api('/api/nonexistent');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });
});
