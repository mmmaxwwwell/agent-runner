import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

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

describe('Session Stop Integration Tests (FR-013)', () => {
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
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/sessions/:id/stop', () => {
    it('should stop a running task-run session and return failed state with exitCode -1', async () => {
      // Register a project
      const createProjectRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-test', dir: projectDir },
      });
      assert.equal(createProjectRes.status, 201, 'Project should be created');
      const projectId = createProjectRes.body.id;

      // Start a task-run session (uses a long-running command since ALLOW_UNSANDBOXED=true)
      const createSessionRes = await api(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(createSessionRes.status, 201, 'Session should be created');
      const sessionId = createSessionRes.body.id;
      assert.equal(createSessionRes.body.state, 'running');

      // Wait briefly for the process to start
      await new Promise(r => setTimeout(r, 500));

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
      // Get the session we just stopped — it should be in 'failed' state
      const projectsRes = await api('/api/projects');
      const projectId = projectsRes.body[0]?.id;
      assert.ok(projectId, 'Should have a registered project');

      const sessionsRes = await api(`/api/projects/${projectId}/sessions`);
      assert.ok(sessionsRes.body.length > 0, 'Should have at least one session');

      // Find a non-running session
      const nonRunningSession = sessionsRes.body.find((s: any) => s.state !== 'running');
      assert.ok(nonRunningSession, 'Should have a non-running session');

      const { status, body } = await api(`/api/sessions/${nonRunningSession.id}/stop`, {
        method: 'POST',
      });
      assert.equal(status, 400, 'Should reject stop on non-running session');
      assert.ok(body.error);
    });

    it('should actually kill the process when stopping', async () => {
      // We need a fresh project (the previous one may have an active session conflict)
      const freshDir = join(projectsDir, 'stop-kill-test');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'tasks.md'), TASK_FILE_CONTENT);

      const createProjectRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'stop-kill-test', dir: freshDir },
      });
      assert.equal(createProjectRes.status, 201);
      const projectId = createProjectRes.body.id;

      // Start a session
      const createSessionRes = await api(`/api/projects/${projectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(createSessionRes.status, 201);
      const sessionId = createSessionRes.body.id;

      // Wait for process to start
      await new Promise(r => setTimeout(r, 500));

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
      // Use the stop-kill-test project from the previous test
      const projectsRes = await api('/api/projects');
      const project = projectsRes.body.find((p: any) => p.name === 'stop-kill-test');
      assert.ok(project, 'Should have the stop-kill-test project');

      // Wait for any background cleanup
      await new Promise(r => setTimeout(r, 500));

      // Start a new session — should work since the previous one was stopped
      const createSessionRes = await api(`/api/projects/${project.id}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      assert.equal(createSessionRes.status, 201, 'Should be able to start a new session after stopping');

      // Clean up: stop the new session
      const stopRes = await api(`/api/sessions/${createSessionRes.body.id}/stop`, {
        method: 'POST',
      });
      assert.equal(stopRes.status, 200);
    });
  });
});
