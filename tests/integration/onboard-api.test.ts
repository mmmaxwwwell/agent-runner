/**
 * Integration Tests: Onboard API — POST /api/projects/onboard
 *
 * Validates the onboard endpoint per specs/003-project-discovery/contracts/discovery-api.md
 * Covers: successful onboard (201), missing path (400), non-directory (400),
 * already registered (409), project persists in projects.json
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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

describe('Onboard API Integration Tests — POST /api/projects/onboard', () => {
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

  it('should persist the onboarded project in projects.json', async () => {
    // The project from the previous test should be in projects.json
    const raw = readFileSync(join(dataDir, 'projects.json'), 'utf-8');
    const projects = JSON.parse(raw);
    const found = projects.find((p: any) => p.name === 'my-new-project');
    assert.ok(found, 'Onboarded project should be persisted in projects.json');
    assert.equal(found.status, 'onboarding');
  });

  it('should return the onboarded project in GET /api/projects registered array', async () => {
    const { body } = await api('/api/projects');
    const proj = body.registered.find((p: any) => p.name === 'my-new-project');
    assert.ok(proj, 'Onboarded project should appear in registered array');
    assert.equal(proj.status, 'onboarding');
  });

  it('should return 400 when path is missing', async () => {
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
});
