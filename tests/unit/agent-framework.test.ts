import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// The module under test — will be implemented in T010
import { ensureAgentFramework } from '../../src/services/agent-framework.ts';

describe('ensureAgentFramework', () => {
  let tmpDir: string;
  let bareRepoPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-fw-test-'));
    // Create a bare git repo to act as the "remote" for cloning
    bareRepoPath = join(tmpDir, 'remote.git');
    mkdirSync(bareRepoPath);
    execFileSync('git', ['init', '--bare', bareRepoPath]);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should clone the repo when agent-framework directory does not exist', () => {
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);

    ensureAgentFramework(dataDir, bareRepoPath);

    const agentFwDir = join(dataDir, 'agent-framework');
    assert.ok(existsSync(agentFwDir), 'agent-framework directory should be created');
    assert.ok(existsSync(join(agentFwDir, '.git')), 'should be a git repository');
  });

  it('should pull when agent-framework directory already exists with a git repo', () => {
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);

    // First call clones
    ensureAgentFramework(dataDir, bareRepoPath);

    // Second call should pull (not error)
    assert.doesNotThrow(() => {
      ensureAgentFramework(dataDir, bareRepoPath);
    }, 'should not throw when pulling an existing repo');
  });

  it('should handle clone failure gracefully with a clear error', () => {
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);

    // Use an invalid repo URL to trigger clone failure
    assert.throws(
      () => ensureAgentFramework(dataDir, 'file:///nonexistent/repo.git'),
      /clone|failed|error/i,
      'should throw with a descriptive error on clone failure',
    );

    // The agent-framework directory should not exist after a failed clone
    const agentFwDir = join(dataDir, 'agent-framework');
    assert.ok(!existsSync(agentFwDir) || !existsSync(join(agentFwDir, '.git')),
      'should not leave a partial clone on failure');
  });

  it('should handle pull failure gracefully when repo is corrupted', () => {
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);

    // Create a directory that looks like agent-framework but isn't a valid git repo
    const agentFwDir = join(dataDir, 'agent-framework');
    mkdirSync(agentFwDir);
    mkdirSync(join(agentFwDir, '.git')); // fake .git dir, not a real repo

    assert.throws(
      () => ensureAgentFramework(dataDir, bareRepoPath),
      /pull|failed|error/i,
      'should throw with a descriptive error on pull failure',
    );
  });

  it('should create the dataDir if it does not exist', () => {
    const dataDir = join(tmpDir, 'nonexistent', 'nested', 'data');

    ensureAgentFramework(dataDir, bareRepoPath);

    assert.ok(existsSync(dataDir), 'dataDir should be created');
    assert.ok(existsSync(join(dataDir, 'agent-framework', '.git')), 'repo should be cloned');
  });

  it('should use the default repo URL when none is provided', () => {
    // This test verifies the function signature accepts a single argument.
    // It will fail to clone (no network in CI) but should attempt with the default URL.
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);

    // We can't test actual clone from GitHub, but verify the function
    // accepts a single argument without throwing a TypeError
    try {
      ensureAgentFramework(dataDir);
    } catch (e: unknown) {
      // Expected to fail (no network or GitHub access) — but it should
      // be a git error, not a missing-argument error
      const msg = (e as Error).message;
      assert.ok(!msg.includes('TypeError'), 'should not throw TypeError for missing repoUrl');
    }
  });
});
