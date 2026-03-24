/**
 * Integration Tests: Unified Onboard API — POST /api/projects/onboard
 *
 * Validates the unified onboard endpoint per specs/004-onboarding-overhaul/contracts/rest-api.md
 * Covers:
 * - Discovered directory onboarding (201, response shape with sessionId)
 * - New project creation via newProject flag (201, directory creation)
 * - Duplicate rejection (409) for both discovered dirs and new projects
 * - Idempotent re-onboard for projects in "onboarding" or "error" status
 * - Validation: missing path, non-directory, invalid name characters, mutually exclusive options
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

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

describe('Unified Onboard API Integration Tests — POST /api/projects/onboard', () => {
  let onboardableDir: string;
  let aFileNotDir: string;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'onboard-api-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');
    mkdirSync(projectsDir, { recursive: true });

    // Create a directory that can be onboarded
    onboardableDir = join(projectsDir, 'my-new-project');
    mkdirSync(onboardableDir, { recursive: true });

    // Create a second directory for the already-registered test
    const alreadyRegisteredDir = join(projectsDir, 'already-registered');
    mkdirSync(alreadyRegisteredDir, { recursive: true });
    writeFileSync(join(alreadyRegisteredDir, 'tasks.md'), '# Tasks\n- [ ] task 1\n');

    // Create a file (not a directory) for the non-directory test
    aFileNotDir = join(tmpDir, 'some-file.txt');
    writeFileSync(aFileNotDir, 'not a directory');

    baseUrl = `http://127.0.0.1:${PORT}`;
    await startServer();

    // Pre-register one project so we can test the 409 case
    const res = await api('/api/projects', {
      method: 'POST',
      body: { name: 'already-registered', dir: alreadyRegisteredDir },
    });
    assert.equal(res.status, 201, 'Setup: already-registered project should register');
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Discovered directory onboarding ──

  describe('Discovered directory onboarding', () => {
    it('should return 201 and register a discovered directory', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'my-new-project', path: onboardableDir },
      });

      assert.equal(status, 201);
      assert.ok(body.projectId, 'Response should have projectId');
      assert.equal(body.name, 'my-new-project');
      assert.equal(body.path, onboardableDir);
      assert.equal(body.status, 'onboarding');
    });

    it('should include sessionId in 201 response', async () => {
      // Onboard a fresh directory to check response shape
      const freshDir = join(projectsDir, 'session-id-check');
      mkdirSync(freshDir, { recursive: true });

      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'session-id-check', path: freshDir },
      });

      assert.equal(status, 201);
      assert.ok(body.sessionId, 'Response should have sessionId for the interview session');
      assert.ok(body.projectId, 'Response should have projectId');
      assert.equal(body.status, 'onboarding');
    });

    it('should persist the onboarded project in projects.json', async () => {
      const raw = readFileSync(join(dataDir, 'projects.json'), 'utf-8');
      const projects = JSON.parse(raw);
      const found = projects.find((p: any) => p.name === 'my-new-project');
      assert.ok(found, 'Onboarded project should be persisted in projects.json');
      assert.ok(
        found.status === 'onboarding' || found.status === 'error',
        `Expected status onboarding or error, got ${found.status}`,
      );
    });

    it('should return the onboarded project in GET /api/projects registered array', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'my-new-project');
      assert.ok(proj, 'Onboarded project should appear in registered array');
      assert.ok(
        proj.status === 'onboarding' || proj.status === 'error',
        `Expected status onboarding or error, got ${proj.status}`,
      );
    });

    it('should derive name from path basename when name is omitted', async () => {
      const autoNameDir = join(projectsDir, 'auto-named-project');
      mkdirSync(autoNameDir, { recursive: true });

      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { path: autoNameDir },
      });

      assert.equal(status, 201);
      assert.equal(body.name, 'auto-named-project', 'Name should be derived from directory basename');
    });
  });

  // ── Validation errors ──

  describe('Validation errors', () => {
    it('should return 400 when path is missing and newProject is not set', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'no-path' },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
      assert.ok(body.error.includes('path'), 'Error should mention path');
    });

    it('should return 400 when path is not a string', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'bad-path', path: 12345 },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
    });

    it('should return 400 when path does not exist', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'ghost', path: join(tmpDir, 'nonexistent-dir') },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
    });

    it('should return 400 when path is not a directory', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'file-not-dir', path: aFileNotDir },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
      assert.ok(body.error.includes('not a directory'), 'Error should mention not a directory');
    });

    it('should return 400 when remoteUrl and createGithubRepo are both set', async () => {
      const mutexDir = join(projectsDir, 'mutex-test');
      mkdirSync(mutexDir, { recursive: true });

      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: {
          name: 'mutex-test',
          path: mutexDir,
          remoteUrl: 'git@github.com:user/repo.git',
          createGithubRepo: true,
        },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
    });
  });

  // ── Duplicate rejection (409) ──

  describe('Duplicate rejection', () => {
    it('should return 409 when directory is already registered', async () => {
      const alreadyRegisteredDir = join(projectsDir, 'already-registered');
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'already-registered', path: alreadyRegisteredDir },
      });

      assert.equal(status, 409);
      assert.ok(body.error, 'Should have error message');
      assert.ok(body.error.includes('already registered'), 'Error should mention already registered');
    });

    it('should return 409 when newProject name matches an existing project', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'already-registered', newProject: true },
      });

      assert.equal(status, 409);
      assert.ok(body.error, 'Should have error message');
    });

    it('should return 409 when newProject name matches a directory on disk', async () => {
      // Create a directory that collides with the new project name
      const collisionDir = join(projectsDir, 'disk-collision');
      mkdirSync(collisionDir, { recursive: true });

      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'disk-collision', newProject: true },
      });

      assert.equal(status, 409);
      assert.ok(body.error, 'Should have error message');
    });
  });

  // ── New project creation via newProject flag ──

  describe('New project creation (newProject: true)', () => {
    it('should return 201 and create a new project directory', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'brand-new-project', newProject: true },
      });

      assert.equal(status, 201);
      assert.ok(body.projectId, 'Response should have projectId');
      assert.ok(body.sessionId, 'Response should have sessionId');
      assert.equal(body.name, 'brand-new-project');
      assert.equal(body.status, 'onboarding');

      // The directory should be created under projectsDir
      const expectedPath = join(projectsDir, 'brand-new-project');
      assert.equal(body.path, expectedPath, 'Path should be under projectsDir');
      assert.ok(existsSync(expectedPath), 'Project directory should exist on disk');
    });

    it('should return 400 when name is missing for newProject', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { newProject: true },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
    });

    it('should return 400 when name contains invalid characters for newProject', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'bad name with spaces!', newProject: true },
      });

      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error message');
    });

    it('should accept valid name characters (letters, numbers, dots, hyphens, underscores)', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'valid.name_with-chars123', newProject: true },
      });

      assert.equal(status, 201);
      assert.equal(body.name, 'valid.name_with-chars123');
    });

    it('should ignore path when newProject is true', async () => {
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'ignore-path-test', newProject: true, path: '/some/bogus/path' },
      });

      assert.equal(status, 201);
      // Path should be derived from projectsDir, not the provided path
      const expectedPath = join(projectsDir, 'ignore-path-test');
      assert.equal(body.path, expectedPath);
    });

    it('should persist the new project in projects.json with onboarding status', async () => {
      // Read projects.json and find the project created in the first newProject test
      const raw = readFileSync(join(dataDir, 'projects.json'), 'utf-8');
      const projects = JSON.parse(raw);
      const found = projects.find((p: any) => p.name === 'brand-new-project');
      assert.ok(found, 'New project should be persisted in projects.json');
      assert.ok(
        found.status === 'onboarding' || found.status === 'error',
        `Expected status onboarding or error, got ${found.status}`,
      );
    });
  });

  // ── Idempotent re-onboard ──

  describe('Idempotent re-onboard', () => {
    it('should allow re-onboarding a project in "onboarding" status', async () => {
      // The 'my-new-project' was onboarded earlier with status "onboarding"
      // Re-onboarding should succeed (idempotent — re-runs pipeline from where it left off)
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'my-new-project', path: onboardableDir },
      });

      // Should succeed with 200 or 201, not 409
      assert.ok(status === 200 || status === 201, `Expected 200 or 201 for re-onboard, got ${status}`);
      assert.ok(body.projectId, 'Response should have projectId');
      assert.ok(body.sessionId, 'Response should have sessionId');
      assert.equal(body.status, 'onboarding');
    });

    it('should allow re-onboarding a project in "error" status', async () => {
      // Create a project and manually set its status to "error"
      const errorDir = join(projectsDir, 'error-project');
      mkdirSync(errorDir, { recursive: true });

      // First onboard it
      const firstRes = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'error-project', path: errorDir },
      });
      assert.equal(firstRes.status, 201);

      // Manually set status to "error" in projects.json
      const raw = readFileSync(join(dataDir, 'projects.json'), 'utf-8');
      const projects = JSON.parse(raw);
      const proj = projects.find((p: any) => p.name === 'error-project');
      assert.ok(proj, 'error-project should exist');
      proj.status = 'error';
      writeFileSync(join(dataDir, 'projects.json'), JSON.stringify(projects, null, 2) + '\n');

      // Re-onboard should succeed (retry from error)
      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'error-project', path: errorDir },
      });

      assert.ok(status === 200 || status === 201, `Expected 200 or 201 for re-onboard from error, got ${status}`);
      assert.ok(body.projectId, 'Response should have projectId');
      assert.equal(body.status, 'onboarding');
    });

    it('should return 409 when re-onboarding a project in "active" status', async () => {
      // Pre-register an active project via the standard registration endpoint
      // (createProject sets status to 'active')
      // The 'already-registered' project was registered in before() with status 'active'
      const alreadyRegisteredDir = join(projectsDir, 'already-registered');

      const { status, body } = await api('/api/projects/onboard', {
        method: 'POST',
        body: { name: 'already-registered', path: alreadyRegisteredDir },
      });

      assert.equal(status, 409);
      assert.ok(body.error, 'Should have error message');
      assert.ok(body.error.includes('already registered'), 'Error should mention already registered');
    });
  });
});
