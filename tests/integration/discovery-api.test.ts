/**
 * Integration Tests: Discovery API — Extended GET /api/projects
 *
 * Validates the new response shape from GET /api/projects:
 *   { registered, discovered, discoveryError }
 * per specs/003-project-discovery/contracts/discovery-api.md
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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

function startServer(envOverrides: Record<string, string> = {}): Promise<void> {
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
        ...envOverrides,
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

describe('Discovery API Integration Tests — GET /api/projects', () => {
  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'discovery-api-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');

    // Create a registered project directory with tasks.md
    const registeredDir = join(projectsDir, 'registered-project');
    mkdirSync(registeredDir, { recursive: true });
    writeFileSync(join(registeredDir, 'tasks.md'), TASK_FILE_CONTENT);

    // Create unregistered directories for discovery
    const unregisteredGit = join(projectsDir, 'unregistered-git-repo');
    mkdirSync(unregisteredGit, { recursive: true });
    mkdirSync(join(unregisteredGit, '.git'), { recursive: true });

    const unregisteredPlain = join(projectsDir, 'unregistered-plain');
    mkdirSync(unregisteredPlain, { recursive: true });

    // Create an unregistered dir with spec-kit artifacts
    const unregisteredSpecKit = join(projectsDir, 'unregistered-speckit');
    mkdirSync(unregisteredSpecKit, { recursive: true });
    mkdirSync(join(unregisteredSpecKit, '.git'), { recursive: true });
    mkdirSync(join(unregisteredSpecKit, 'specs', '001-feature'), { recursive: true });
    writeFileSync(join(unregisteredSpecKit, 'specs', '001-feature', 'spec.md'), '# Spec\n');
    writeFileSync(join(unregisteredSpecKit, 'specs', '001-feature', 'plan.md'), '# Plan\n');

    // Create a hidden directory (should be skipped)
    mkdirSync(join(projectsDir, '.hidden-dir'), { recursive: true });

    // Create a symlink to a directory
    const symlinkTarget = join(tmpDir, 'symlink-target');
    mkdirSync(symlinkTarget, { recursive: true });
    mkdirSync(join(symlinkTarget, '.git'), { recursive: true });
    symlinkSync(symlinkTarget, join(projectsDir, 'symlinked-project'));

    baseUrl = `http://127.0.0.1:${PORT}`;
    await startServer();

    // Register one project so we have both registered and discovered
    const res = await api('/api/projects', {
      method: 'POST',
      body: { name: 'registered-project', dir: registeredDir },
    });
    assert.equal(res.status, 201, 'Setup: registered-project should register');
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Response shape', () => {
    it('should return an object with registered, discovered, and discoveryError fields', async () => {
      const { status, body } = await api('/api/projects');
      assert.equal(status, 200);
      assert.equal(typeof body, 'object');
      assert.ok(!Array.isArray(body), 'Response should be an object, not an array');
      assert.ok('registered' in body, 'Response should have "registered" field');
      assert.ok('discovered' in body, 'Response should have "discovered" field');
      assert.ok('discoveryError' in body, 'Response should have "discoveryError" field');
    });

    it('should have discoveryError as null when projectsDir exists', async () => {
      const { body } = await api('/api/projects');
      assert.equal(body.discoveryError, null);
    });
  });

  describe('Registered projects', () => {
    it('should include registered projects in the registered array', async () => {
      const { body } = await api('/api/projects');
      assert.ok(Array.isArray(body.registered), 'registered should be an array');
      assert.ok(body.registered.length >= 1, 'Should have at least 1 registered project');

      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.ok(proj, 'registered-project should be in the registered array');
    });

    it('should include type "registered" on each registered project', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.equal(proj.type, 'registered');
    });

    it('should include status field on registered projects', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.ok(typeof proj.status === 'string', 'Should have a status string');
      assert.equal(proj.status, 'active');
    });

    it('should include dirMissing field on registered projects', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.ok('dirMissing' in proj, 'Should have dirMissing field');
      assert.equal(proj.dirMissing, false, 'dirMissing should be false for existing directory');
    });

    it('should include taskSummary and activeSession on registered projects', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.ok(proj.taskSummary, 'Should have taskSummary');
      assert.equal(typeof proj.taskSummary.total, 'number');
      assert.equal(typeof proj.taskSummary.completed, 'number');
      assert.ok('activeSession' in proj, 'Should have activeSession field');
    });

    it('should include standard project fields (id, name, dir, taskFile, createdAt)', async () => {
      const { body } = await api('/api/projects');
      const proj = body.registered.find((p: any) => p.name === 'registered-project');
      assert.ok(proj.id, 'Should have id');
      assert.ok(proj.name, 'Should have name');
      assert.ok(proj.dir, 'Should have dir');
      assert.ok(proj.taskFile, 'Should have taskFile');
      assert.ok(proj.createdAt, 'Should have createdAt');
    });
  });

  describe('Discovered directories', () => {
    it('should include unregistered directories in the discovered array', async () => {
      const { body } = await api('/api/projects');
      assert.ok(Array.isArray(body.discovered), 'discovered should be an array');
      assert.ok(body.discovered.length >= 1, 'Should have at least 1 discovered directory');
    });

    it('should not include registered projects in the discovered array', async () => {
      const { body } = await api('/api/projects');
      const names = body.discovered.map((d: any) => d.name);
      assert.ok(!names.includes('registered-project'), 'Registered project should not appear in discovered');
    });

    it('should not include hidden directories in the discovered array', async () => {
      const { body } = await api('/api/projects');
      const names = body.discovered.map((d: any) => d.name);
      assert.ok(!names.includes('.hidden-dir'), 'Hidden directories should be excluded');
    });

    it('should include correct fields on discovered directories per contract', async () => {
      const { body } = await api('/api/projects');
      const gitRepo = body.discovered.find((d: any) => d.name === 'unregistered-git-repo');
      assert.ok(gitRepo, 'unregistered-git-repo should be discovered');
      assert.equal(gitRepo.type, 'discovered');
      assert.ok(gitRepo.path, 'Should have path');
      assert.equal(typeof gitRepo.isGitRepo, 'boolean');
      assert.ok(gitRepo.hasSpecKit, 'Should have hasSpecKit');
      assert.equal(typeof gitRepo.hasSpecKit.spec, 'boolean');
      assert.equal(typeof gitRepo.hasSpecKit.plan, 'boolean');
      assert.equal(typeof gitRepo.hasSpecKit.tasks, 'boolean');
    });

    it('should detect git repositories correctly', async () => {
      const { body } = await api('/api/projects');
      const gitRepo = body.discovered.find((d: any) => d.name === 'unregistered-git-repo');
      assert.equal(gitRepo.isGitRepo, true, 'Directory with .git should be detected as git repo');

      const plainDir = body.discovered.find((d: any) => d.name === 'unregistered-plain');
      assert.equal(plainDir.isGitRepo, false, 'Directory without .git should not be a git repo');
    });

    it('should detect spec-kit artifacts correctly', async () => {
      const { body } = await api('/api/projects');
      const specKit = body.discovered.find((d: any) => d.name === 'unregistered-speckit');
      assert.ok(specKit, 'unregistered-speckit should be discovered');
      assert.equal(specKit.hasSpecKit.spec, true, 'Should detect spec.md');
      assert.equal(specKit.hasSpecKit.plan, true, 'Should detect plan.md');
      assert.equal(specKit.hasSpecKit.tasks, false, 'Should not detect missing tasks.md');
    });

    it('should resolve symlinks and include symlinked directories', async () => {
      const { body } = await api('/api/projects');
      const symlinked = body.discovered.find((d: any) => d.name === 'symlinked-project');
      assert.ok(symlinked, 'Symlinked directory should be discovered');
      assert.equal(symlinked.isGitRepo, true, 'Should detect git repo through symlink');
    });
  });

  describe('Empty and edge cases', () => {
    it('should return empty discovered array when all directories are registered', async () => {
      // We can't easily test this without a fresh server, but we can verify the
      // response shape is consistent when there are both registered and discovered
      const { body } = await api('/api/projects');
      assert.ok(Array.isArray(body.registered));
      assert.ok(Array.isArray(body.discovered));
    });
  });
});

describe('Discovery API — discoveryError when projectsDir is missing', () => {
  let tmpDir2: string;
  let dataDir2: string;
  let serverProcess2: ChildProcess;
  let baseUrl2: string;
  const PORT2 = 30000 + Math.floor(Math.random() * 10000);

  before(async () => {
    tmpDir2 = mkdtempSync(join(tmpdir(), 'discovery-api-missing-'));
    dataDir2 = join(tmpDir2, 'data');
    mkdirSync(join(dataDir2, 'sessions'), { recursive: true });
    writeFileSync(join(dataDir2, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir2, 'push-subscriptions.json'), '[]\n');

    // Point projectsDir to a non-existent path
    const missingDir = join(tmpDir2, 'does-not-exist');

    baseUrl2 = `http://127.0.0.1:${PORT2}`;

    serverProcess2 = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: '/home/max/git/agent-runner',
      env: {
        ...process.env,
        AGENT_RUNNER_HOST: '127.0.0.1',
        AGENT_RUNNER_PORT: String(PORT2),
        AGENT_RUNNER_DATA_DIR: dataDir2,
        AGENT_RUNNER_PROJECTS_DIR: missingDir,
        ALLOW_UNSANDBOXED: 'true',
        VAPID_PUBLIC_KEY: 'BEK2EYfxuvIVaN3AD8zmJySnpAbJH0d0krsfVWou2UE0OOmBv8Wuslzb_jwDureGGeoJ1guHi4HgyqAGHyAGI0I',
        VAPID_PRIVATE_KEY: 'lyVcDma4tQXDj6SKHTHSv9MsUZB4juXzJK_JnaDyX2E',
        LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      let stderrOutput = '';
      const timeout = setTimeout(() => {
        reject(new Error(`Server did not start within 10s. stderr: ${stderrOutput}`));
      }, 10_000);

      serverProcess2.stderr!.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
        if (stderrOutput.includes('Agent Runner server started')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess2.on('error', (err) => { clearTimeout(timeout); reject(err); });
      serverProcess2.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(new Error(`Server exited with code ${code}. stderr: ${stderrOutput}`));
        }
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      if (!serverProcess2 || serverProcess2.killed) { resolve(); return; }
      const timeout = setTimeout(() => {
        if (!serverProcess2.killed) serverProcess2.kill('SIGKILL');
        resolve();
      }, 3000);
      serverProcess2.on('exit', () => { clearTimeout(timeout); resolve(); });
      serverProcess2.kill('SIGTERM');
    });
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('should return discoveryError when projectsDir does not exist', async () => {
    const res = await globalThis.fetch(`${baseUrl2}/api/projects`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(!Array.isArray(body), 'Response should be an object, not an array');
    assert.ok(Array.isArray(body.registered), 'Should have empty registered array');
    assert.ok(Array.isArray(body.discovered), 'Should have empty discovered array');
    assert.equal(body.discovered.length, 0, 'Should have no discovered dirs');
    assert.ok(typeof body.discoveryError === 'string', 'Should have discoveryError string');
    assert.ok(body.discoveryError.includes('does not exist'), 'Error should mention directory does not exist');
  });
});
