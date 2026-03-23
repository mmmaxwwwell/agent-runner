import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Save original env to restore after each test
const originalEnv = { ...process.env };

function setMinimalEnv(dataDir: string, projectsDir: string): void {
  process.env['AGENT_RUNNER_DATA_DIR'] = dataDir;
  process.env['AGENT_RUNNER_PROJECTS_DIR'] = projectsDir;
  // Provide VAPID keys so we don't trigger web-push auto-generation
  process.env['VAPID_PUBLIC_KEY'] = 'test-public-key';
  process.env['VAPID_PRIVATE_KEY'] = 'test-private-key';
}

describe('config', () => {
  let tmpDir: string;
  let dataDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'config-test-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    // Reset env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AGENT_RUNNER_') || key.startsWith('VAPID_') || key === 'LOG_LEVEL' || key === 'ALLOW_UNSANDBOXED' || key === 'GOOGLE_STT_API_KEY' || key === 'DISK_WARN_THRESHOLD_MB') {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Dynamic import to pick up fresh env each time
  async function loadConfigFresh() {
    // Use cache-busting query to force re-import
    const mod = await import(`../../src/lib/config.ts?t=${Date.now()}-${Math.random()}`);
    return mod.loadConfig as typeof import('../../src/lib/config.ts').loadConfig;
  }

  it('should load default values with minimal env', async () => {
    setMinimalEnv(dataDir, projectsDir);
    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.vapidSubject, 'mailto:agent-runner@localhost');
    assert.equal(config.allowUnsandboxed, false);
    assert.equal(config.googleSttApiKey, null);
    assert.equal(config.diskWarnThresholdMb, 8192);
  });

  it('should read all env vars', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['AGENT_RUNNER_HOST'] = '0.0.0.0';
    process.env['AGENT_RUNNER_PORT'] = '8080';
    process.env['LOG_LEVEL'] = 'debug';
    process.env['VAPID_SUBJECT'] = 'mailto:test@test.com';
    process.env['ALLOW_UNSANDBOXED'] = 'true';
    process.env['GOOGLE_STT_API_KEY'] = 'my-api-key';
    process.env['DISK_WARN_THRESHOLD_MB'] = '4096';

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 8080);
    assert.equal(config.logLevel, 'debug');
    assert.equal(config.vapidSubject, 'mailto:test@test.com');
    assert.equal(config.allowUnsandboxed, true);
    assert.equal(config.googleSttApiKey, 'my-api-key');
    assert.equal(config.diskWarnThresholdMb, 4096);
  });

  it('should throw when AGENT_RUNNER_PROJECTS_DIR is missing', async () => {
    process.env['AGENT_RUNNER_DATA_DIR'] = dataDir;
    process.env['VAPID_PUBLIC_KEY'] = 'test-public-key';
    process.env['VAPID_PRIVATE_KEY'] = 'test-private-key';
    // No AGENT_RUNNER_PROJECTS_DIR set

    const loadConfig = await loadConfigFresh();
    assert.throws(() => loadConfig(), /AGENT_RUNNER_PROJECTS_DIR.*required/);
  });

  it('should throw on invalid LOG_LEVEL', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['LOG_LEVEL'] = 'verbose';

    const loadConfig = await loadConfigFresh();
    assert.throws(() => loadConfig(), /Invalid LOG_LEVEL/);
  });

  it('should throw on invalid AGENT_RUNNER_PORT', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['AGENT_RUNNER_PORT'] = 'notanumber';

    const loadConfig = await loadConfigFresh();
    assert.throws(() => loadConfig(), /Invalid AGENT_RUNNER_PORT/);
  });

  it('should throw on out-of-range port', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['AGENT_RUNNER_PORT'] = '99999';

    const loadConfig = await loadConfigFresh();
    assert.throws(() => loadConfig(), /Invalid AGENT_RUNNER_PORT/);
  });

  it('should throw on invalid DISK_WARN_THRESHOLD_MB', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['DISK_WARN_THRESHOLD_MB'] = '-100';

    const loadConfig = await loadConfigFresh();
    assert.throws(() => loadConfig(), /Invalid DISK_WARN_THRESHOLD_MB/);
  });

  it('should use VAPID env vars over file', async () => {
    // Write a vapid-keys.json file
    writeFileSync(
      join(dataDir, 'vapid-keys.json'),
      JSON.stringify({ publicKey: 'file-public', privateKey: 'file-private' })
    );
    setMinimalEnv(dataDir, projectsDir);
    process.env['VAPID_PUBLIC_KEY'] = 'env-public';
    process.env['VAPID_PRIVATE_KEY'] = 'env-private';

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    assert.equal(config.vapidPublicKey, 'env-public');
    assert.equal(config.vapidPrivateKey, 'env-private');
  });

  it('should load VAPID keys from file when env vars absent', async () => {
    writeFileSync(
      join(dataDir, 'vapid-keys.json'),
      JSON.stringify({ publicKey: 'file-public', privateKey: 'file-private' })
    );
    process.env['AGENT_RUNNER_DATA_DIR'] = dataDir;
    process.env['AGENT_RUNNER_PROJECTS_DIR'] = projectsDir;
    // No VAPID env vars

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    assert.equal(config.vapidPublicKey, 'file-public');
    assert.equal(config.vapidPrivateKey, 'file-private');
  });

  it('should auto-generate VAPID keys when none exist', async () => {
    process.env['AGENT_RUNNER_DATA_DIR'] = dataDir;
    process.env['AGENT_RUNNER_PROJECTS_DIR'] = projectsDir;
    // No VAPID env vars, no file

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    // Keys should be non-empty strings
    assert.ok(config.vapidPublicKey.length > 0);
    assert.ok(config.vapidPrivateKey.length > 0);

    // Should have written the file
    const vapidPath = join(dataDir, 'vapid-keys.json');
    assert.ok(existsSync(vapidPath));
    const saved = JSON.parse(readFileSync(vapidPath, 'utf-8'));
    assert.equal(saved.publicKey, config.vapidPublicKey);
    assert.equal(saved.privateKey, config.vapidPrivateKey);
  });

  it('should default dataDir to ~/.agent-runner when env not set', async () => {
    process.env['AGENT_RUNNER_PROJECTS_DIR'] = projectsDir;
    process.env['VAPID_PUBLIC_KEY'] = 'test-public-key';
    process.env['VAPID_PRIVATE_KEY'] = 'test-private-key';
    // No AGENT_RUNNER_DATA_DIR

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();

    const { homedir } = await import('node:os');
    const { resolve } = await import('node:path');
    assert.equal(config.dataDir, resolve(homedir(), '.agent-runner'));
  });

  it('should treat ALLOW_UNSANDBOXED=false as false', async () => {
    setMinimalEnv(dataDir, projectsDir);
    process.env['ALLOW_UNSANDBOXED'] = 'false';

    const loadConfig = await loadConfigFresh();
    const config = loadConfig();
    assert.equal(config.allowUnsandboxed, false);
  });

  it('should accept all valid log levels', async () => {
    const validLevels = ['debug', 'info', 'warn', 'error', 'fatal'];
    for (const level of validLevels) {
      setMinimalEnv(dataDir, projectsDir);
      process.env['LOG_LEVEL'] = level;

      const loadConfig = await loadConfigFresh();
      const config = loadConfig();
      assert.equal(config.logLevel, level);
    }
  });
});
