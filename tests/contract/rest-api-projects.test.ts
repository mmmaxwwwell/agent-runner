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

describe('REST API: Projects Contract Tests', () => {
  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'contract-projects-'));
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

  describe('GET /api/projects', () => {
    it('should return 200 with empty registered array when no projects registered', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.ok(!Array.isArray(body), 'Response should be an object, not an array');
      assert.ok(Array.isArray(body.registered), 'Should have registered array');
      assert.equal(body.registered.length, 0);
      assert.ok(Array.isArray(body.discovered), 'Should have discovered array');
      assert.ok('discoveryError' in body, 'Should have discoveryError field');
    });
  });

  describe('POST /api/projects', () => {
    it('should return 201 with the created project', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'test-project', dir: projectDir },
      });
      assert.equal(status, 201);
      assert.equal(body.name, 'test-project');
      assert.equal(body.dir, projectDir);
      assert.ok(body.id, 'Should have an id');
      assert.ok(body.createdAt, 'Should have a createdAt');
      assert.ok(body.taskFile, 'Should have a taskFile');
    });

    it('should return 400 when name is missing', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { dir: projectDir },
      });
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 400 when dir is missing', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'test' },
      });
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 400 when directory does not exist', async () => {
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'ghost', dir: '/tmp/nonexistent-dir-12345' },
      });
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 400 when no tasks.md in directory', async () => {
      const emptyDir = join(projectsDir, 'empty-project');
      mkdirSync(emptyDir, { recursive: true });
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'empty', dir: emptyDir },
      });
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return 409 when project with same dir is already registered', async () => {
      // First registration (may already exist from prior test)
      await api('/api/projects', {
        method: 'POST',
        body: { name: 'dup-project', dir: projectDir },
      });
      // Second registration with same dir should conflict
      const { status, body } = await api('/api/projects', {
        method: 'POST',
        body: { name: 'dup-project-2', dir: projectDir },
      });
      assert.equal(status, 409);
      assert.ok(body.error, 'Should have an error message');
    });
  });

  describe('GET /api/projects (after registration)', () => {
    it('should return registered projects with taskSummary', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.registered));
      assert.ok(body.registered.length > 0, 'Should have at least one project');

      const project = body.registered[0];
      assert.ok(project.id);
      assert.ok(project.name);
      assert.ok(project.dir);
      assert.equal(project.type, 'registered');
      assert.ok(project.taskSummary, 'Should include taskSummary');
      assert.equal(typeof project.taskSummary.total, 'number');
      assert.equal(typeof project.taskSummary.completed, 'number');
      assert.equal(typeof project.taskSummary.blocked, 'number');
      assert.equal(typeof project.taskSummary.skipped, 'number');
      assert.equal(typeof project.taskSummary.remaining, 'number');
    });

    it('should include activeSession field (null when no session)', async () => {
      const { body } = await api('/api/projects');
      const project = body.registered[0];
      assert.ok('activeSession' in project, 'Should have activeSession field');
      assert.equal(project.activeSession, null);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return 200 with project detail including tasks array', async () => {
      // Get a project id from the list
      const listRes = await api('/api/projects');
      const projectId = listRes.body.registered[0]?.id;
      assert.ok(projectId, 'Need a registered project');

      const { status, body } = await api(`/api/projects/${projectId}`);
      assert.equal(status, 200);
      assert.equal(body.id, projectId);
      assert.ok(body.name);
      assert.ok(body.dir);
      assert.ok(body.taskSummary, 'Should include taskSummary');
      assert.ok(Array.isArray(body.tasks), 'Should include tasks array');
      assert.ok(body.tasks.length > 0, 'Should have parsed tasks');

      // Verify task structure per rest-api.md
      const task = body.tasks[0];
      assert.ok(task.id, 'Task should have id');
      assert.equal(typeof task.phase, 'number', 'Task should have numeric phase');
      assert.ok(task.phaseName, 'Task should have phaseName');
      assert.ok(
        ['unchecked', 'checked', 'blocked', 'skipped'].includes(task.status),
        'Task should have valid status',
      );
      assert.ok(task.description, 'Task should have description');
      assert.ok('blockedReason' in task, 'Task should have blockedReason field');
      assert.equal(typeof task.depth, 'number', 'Task should have numeric depth');
    });

    it('should include sessions array', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body.registered[0]?.id;

      const { body } = await api(`/api/projects/${projectId}`);
      assert.ok(Array.isArray(body.sessions), 'Should include sessions array');
    });

    it('should return 404 for unknown project id', async () => {
      const { status, body } = await api('/api/projects/nonexistent-id-99999');
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should return 204 when project is deleted successfully', async () => {
      // Register a fresh project to delete
      const delDir = join(projectsDir, 'to-delete');
      mkdirSync(delDir, { recursive: true });
      writeFileSync(join(delDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');

      const createRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'to-delete', dir: delDir },
      });
      assert.equal(createRes.status, 201);
      const projectId = createRes.body.id;

      const { status } = await api(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      assert.equal(status, 204);

      // Verify it's gone
      const getRes = await api(`/api/projects/${projectId}`);
      assert.equal(getRes.status, 404);
    });

    it('should return 404 for unknown project id', async () => {
      const { status, body } = await api('/api/projects/nonexistent-id-99999', {
        method: 'DELETE',
      });
      assert.equal(status, 404);
      assert.ok(body.error);
    });
  });
});
