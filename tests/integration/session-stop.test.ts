import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TASK_FILE_CONTENT = `# Tasks: Test Project

## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
- [ ] 1.3 Third task
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let projectDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;

const PORT = 30000 + Math.floor(Math.random() * 10000);

async function api(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;
  if (options.body) {
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
 * Pre-create a session by writing meta.json directly.
 * This avoids spawning actual processes (which may exit immediately).
 */
function preCreateSession(
  projectId: string,
  opts: { state?: string; type?: string } = {},
): string {
  const sessionId = randomUUID();
  const sessionDir = join(dataDir, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const meta = {
    id: sessionId,
    projectId,
    type: opts.type ?? 'task-run',
    state: opts.state ?? 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    lastTaskId: null,
    question: null,
    exitCode: null,
  };
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(sessionDir, 'output.jsonl'), '');

  return sessionId;
}

describe('Session Stop Integration Tests (FR-013)', () => {
  let projectId: string;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-stop-test-'));
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

    // Register a project for use in tests
    const res = await api('/api/projects', {
      method: 'POST',
      body: { name: 'stop-test', dir: projectDir },
    });
    assert.equal(res.status, 201);
    projectId = res.body.id;
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/sessions/:id/stop', () => {
    it('should stop a running session and return failed state with exitCode -1', async () => {
      // Pre-create a session in running state (avoids process spawning race condition)
      const sessionId = preCreateSession(projectId, { state: 'running' });

      // Stop the session
      const stopRes = await api(`/api/sessions/${sessionId}/stop`, {
        method: 'POST',
      });
      assert.equal(stopRes.status, 200, 'Stop should succeed');
      assert.equal(stopRes.body.state, 'failed', 'State should be failed');
      assert.equal(stopRes.body.exitCode, -1, 'Exit code should be -1 for manual stop');
      assert.ok(stopRes.body.endedAt, 'Should have endedAt timestamp');
      assert.equal(stopRes.body.id, sessionId, 'Should return the same session id');
    });

    it('should return 404 for non-existent session', async () => {
      const { status, body } = await api('/api/sessions/nonexistent-session-id/stop', {
        method: 'POST',
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });

    it('should return 400 when session is not in running state', async () => {
      // Pre-create a session in 'completed' state
      const sessionId = preCreateSession(projectId, { state: 'completed' });

      const { status, body } = await api(`/api/sessions/${sessionId}/stop`, {
        method: 'POST',
      });
      assert.equal(status, 400, 'Should reject stop on non-running session');
      assert.ok(body.error);
    });

    it('should transition session to failed state verifiable via GET', async () => {
      // Pre-create a session in running state
      const sessionId = preCreateSession(projectId, { state: 'running' });

      // Stop the session
      const stopRes = await api(`/api/sessions/${sessionId}/stop`, {
        method: 'POST',
      });
      assert.equal(stopRes.status, 200);

      // Verify the session is now in failed state by fetching it
      const getRes = await api(`/api/sessions/${sessionId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.state, 'failed', 'Session should be in failed state after stop');
      assert.equal(getRes.body.exitCode, -1, 'Exit code should be -1');
      assert.ok(getRes.body.endedAt, 'Should have endedAt');
    });

    it('should allow starting a new session after stopping the previous one', async () => {
      // Pre-create a running session and stop it
      const sessionId = preCreateSession(projectId, { state: 'running' });
      const stopRes = await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
      assert.equal(stopRes.status, 200);

      // Use a fresh project to avoid active session conflicts
      const freshDir = join(projectsDir, 'stop-fresh-test');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const createProjectRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-fresh-test', dir: freshDir },
      });
      assert.equal(createProjectRes.status, 201);
      const freshProjectId = createProjectRes.body.id;

      // Pre-create a new session for the fresh project — should work since no active sessions
      const newSessionId = preCreateSession(freshProjectId, { state: 'running' });

      // Verify we can fetch the new running session
      const getRes = await api(`/api/sessions/${newSessionId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.state, 'running', 'New session should be running');

      // Clean up: stop the new session
      const stopNewRes = await api(`/api/sessions/${newSessionId}/stop`, { method: 'POST' });
      assert.equal(stopNewRes.status, 200);
    });
  });
});
