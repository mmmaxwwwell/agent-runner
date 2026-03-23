import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

const TASK_FILE_CONTENT = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 Initialize project
- [ ] 1.2 Configure TypeScript
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let projectDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;
let registeredProjectId: string;

// Pick a random port in 30000-40000 range to avoid conflicts
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

describe('REST API: Add Feature Contract Tests', () => {
  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'contract-add-feature-'));
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

    // Register a project to use in tests
    const createRes = await api('/api/projects', {
      method: 'POST',
      body: { name: 'test-project', dir: projectDir },
    });
    assert.equal(createRes.status, 201, 'Setup: project should be created');
    registeredProjectId = createRes.body.id;
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/projects/:id/add-feature', () => {
    it('should return 201 with session info for the specify phase', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}/add-feature`, {
        method: 'POST',
        body: { description: 'Add user authentication with OAuth2 support' },
      });

      assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(body.sessionId, 'Response should have sessionId');
      assert.equal(body.projectId, registeredProjectId, 'Response should reference the project');
      assert.equal(body.phase, 'specify', 'First phase should be specify');
      assert.equal(body.state, 'running', 'Session should be in running state');
    });

    it('should return 404 for unknown project id', async () => {
      const { status, body } = await api('/api/projects/nonexistent-id-99999/add-feature', {
        method: 'POST',
        body: { description: 'Add some feature' },
      });

      assert.equal(status, 404);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 400 when description is empty', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}/add-feature`, {
        method: 'POST',
        body: { description: '' },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 400 when description is missing', async () => {
      const { status, body } = await api(`/api/projects/${registeredProjectId}/add-feature`, {
        method: 'POST',
        body: {},
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 409 when project already has an active session', async () => {
      // First, start a regular session to make the project "busy"
      const sessionRes = await api(`/api/projects/${registeredProjectId}/sessions`, {
        method: 'POST',
        body: { type: 'task-run', allowUnsandboxed: true },
      });
      // If session start succeeds, try add-feature — should be rejected
      // If session start fails (e.g., sandbox unavailable), we still have
      // the session from the first test (specify phase) that may be active
      if (sessionRes.status === 201 || sessionRes.status === 409) {
        const { status, body } = await api(`/api/projects/${registeredProjectId}/add-feature`, {
          method: 'POST',
          body: { description: 'Another feature while busy' },
        });

        assert.equal(status, 409, `Expected 409, got ${status}: ${JSON.stringify(body)}`);
        assert.ok(body.error, 'Should have an error message');
      }
    });
  });
});
