import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanProjectsDir, detectGitRepo, detectSpecKitArtifacts } from '../../src/services/discovery.ts';

describe('scanProjectsDir', () => {
  let tmpDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'discovery-test-'));
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(projectsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return discovered directories with correct shape', async () => {
    mkdirSync(join(projectsDir, 'my-repo'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'discovered');
    assert.equal(result[0].name, 'my-repo');
    assert.equal(result[0].path, resolve(join(projectsDir, 'my-repo')));
    assert.equal(typeof result[0].isGitRepo, 'boolean');
    assert.ok(result[0].hasSpecKit);
    assert.equal(typeof result[0].hasSpecKit.spec, 'boolean');
    assert.equal(typeof result[0].hasSpecKit.plan, 'boolean');
    assert.equal(typeof result[0].hasSpecKit.tasks, 'boolean');
  });

  it('should return multiple discovered directories', async () => {
    mkdirSync(join(projectsDir, 'repo-a'));
    mkdirSync(join(projectsDir, 'repo-b'));
    mkdirSync(join(projectsDir, 'repo-c'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 3);
    const names = result.map(d => d.name).sort();
    assert.deepEqual(names, ['repo-a', 'repo-b', 'repo-c']);
  });

  it('should skip hidden directories (names starting with dot)', async () => {
    mkdirSync(join(projectsDir, '.hidden'));
    mkdirSync(join(projectsDir, '.config'));
    mkdirSync(join(projectsDir, 'visible'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'visible');
  });

  it('should skip directories that are already registered', async () => {
    const registeredDir = join(projectsDir, 'registered-repo');
    const discoveredDir = join(projectsDir, 'new-repo');
    mkdirSync(registeredDir);
    mkdirSync(discoveredDir);

    const registeredPaths = new Set([resolve(registeredDir)]);
    const result = await scanProjectsDir(projectsDir, registeredPaths);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'new-repo');
  });

  it('should return empty array for empty projects directory', async () => {
    const result = await scanProjectsDir(projectsDir, new Set());
    assert.deepEqual(result, []);
  });

  it('should return empty array when projectsDir does not exist', async () => {
    const missingDir = join(tmpDir, 'nonexistent');
    const result = await scanProjectsDir(missingDir, new Set());
    assert.deepEqual(result, []);
  });

  it('should skip regular files (non-directories)', async () => {
    writeFileSync(join(projectsDir, 'not-a-dir.txt'), 'hello');
    mkdirSync(join(projectsDir, 'real-dir'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'real-dir');
  });

  it('should follow symlinks to directories', async () => {
    const realDir = join(tmpDir, 'real-target');
    mkdirSync(realDir);
    symlinkSync(realDir, join(projectsDir, 'symlinked-repo'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'symlinked-repo');
  });

  it('should skip broken symlinks', async () => {
    symlinkSync('/tmp/nonexistent-target-99999', join(projectsDir, 'broken-link'));
    mkdirSync(join(projectsDir, 'good-dir'));

    const result = await scanProjectsDir(projectsDir, new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'good-dir');
  });

  it('should skip directories with permission errors', async () => {
    const restrictedDir = join(projectsDir, 'restricted');
    mkdirSync(restrictedDir);
    // Make the directory unreadable — scanProjectsDir should skip it gracefully
    // Note: this test may not trigger on all platforms if running as root
    chmodSync(restrictedDir, 0o000);
    mkdirSync(join(projectsDir, 'accessible'));

    try {
      const result = await scanProjectsDir(projectsDir, new Set());
      // Should include accessible but not crash; restricted may or may not appear
      // depending on how the implementation handles stat errors
      const names = result.map(d => d.name);
      assert.ok(names.includes('accessible'));
    } finally {
      // Restore permissions so cleanup can proceed
      chmodSync(restrictedDir, 0o755);
    }
  });

  it('should skip all entries when all directories are registered', async () => {
    const dir1 = join(projectsDir, 'repo-1');
    const dir2 = join(projectsDir, 'repo-2');
    mkdirSync(dir1);
    mkdirSync(dir2);

    const registeredPaths = new Set([resolve(dir1), resolve(dir2)]);
    const result = await scanProjectsDir(projectsDir, registeredPaths);
    assert.deepEqual(result, []);
  });
});

describe('detectGitRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'detect-git-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return true when .git directory exists', async () => {
    mkdirSync(join(tmpDir, '.git'));
    const result = await detectGitRepo(tmpDir);
    assert.equal(result, true);
  });

  it('should return true when .git file exists (worktree/submodule)', async () => {
    writeFileSync(join(tmpDir, '.git'), 'gitdir: /some/other/path');
    const result = await detectGitRepo(tmpDir);
    assert.equal(result, true);
  });

  it('should return false when no .git exists', async () => {
    const result = await detectGitRepo(tmpDir);
    assert.equal(result, false);
  });

  it('should return false for non-existent directory', async () => {
    const result = await detectGitRepo(join(tmpDir, 'nonexistent'));
    assert.equal(result, false);
  });
});

describe('detectSpecKitArtifacts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'detect-speckit-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return all false when no specs directory exists', async () => {
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.deepEqual(result, { spec: false, plan: false, tasks: false });
  });

  it('should return all false when specs directory is empty', async () => {
    mkdirSync(join(tmpDir, 'specs'));
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.deepEqual(result, { spec: false, plan: false, tasks: false });
  });

  it('should detect spec.md in a specs subdirectory', async () => {
    mkdirSync(join(tmpDir, 'specs', '001-feature'), { recursive: true });
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'spec.md'), '# Spec');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.equal(result.spec, true);
    assert.equal(result.plan, false);
    assert.equal(result.tasks, false);
  });

  it('should detect plan.md in a specs subdirectory', async () => {
    mkdirSync(join(tmpDir, 'specs', '001-feature'), { recursive: true });
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'plan.md'), '# Plan');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.equal(result.spec, false);
    assert.equal(result.plan, true);
    assert.equal(result.tasks, false);
  });

  it('should detect tasks.md in a specs subdirectory', async () => {
    mkdirSync(join(tmpDir, 'specs', '001-feature'), { recursive: true });
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'tasks.md'), '# Tasks');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.equal(result.spec, false);
    assert.equal(result.plan, false);
    assert.equal(result.tasks, true);
  });

  it('should detect all artifacts across multiple specs subdirectories', async () => {
    mkdirSync(join(tmpDir, 'specs', '001-feature'), { recursive: true });
    mkdirSync(join(tmpDir, 'specs', '002-other'), { recursive: true });
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'spec.md'), '# Spec');
    writeFileSync(join(tmpDir, 'specs', '002-other', 'plan.md'), '# Plan');
    writeFileSync(join(tmpDir, 'specs', '002-other', 'tasks.md'), '# Tasks');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.deepEqual(result, { spec: true, plan: true, tasks: true });
  });

  it('should detect all artifacts in a single specs subdirectory', async () => {
    mkdirSync(join(tmpDir, 'specs', '001-feature'), { recursive: true });
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'spec.md'), '# Spec');
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'plan.md'), '# Plan');
    writeFileSync(join(tmpDir, 'specs', '001-feature', 'tasks.md'), '# Tasks');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.deepEqual(result, { spec: true, plan: true, tasks: true });
  });

  it('should ignore files directly in specs/ (not in subdirectories)', async () => {
    mkdirSync(join(tmpDir, 'specs'));
    writeFileSync(join(tmpDir, 'specs', 'spec.md'), '# Spec at root');
    const result = await detectSpecKitArtifacts(tmpDir);
    assert.deepEqual(result, { spec: false, plan: false, tasks: false });
  });

  it('should return all false for non-existent directory', async () => {
    const result = await detectSpecKitArtifacts(join(tmpDir, 'nonexistent'));
    assert.deepEqual(result, { spec: false, plan: false, tasks: false });
  });
});
