import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectStack, detectArch, generateFlakeContent, ensureFlakeNix } from '../../src/services/flake-generator.ts';

describe('detectStack', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'detect-stack-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect node when package.json exists', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    assert.equal(detectStack(tmpDir), 'node');
  });

  it('should detect rust when Cargo.toml exists', () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]');
    assert.equal(detectStack(tmpDir), 'rust');
  });

  it('should detect go when go.mod exists', () => {
    writeFileSync(join(tmpDir, 'go.mod'), 'module example');
    assert.equal(detectStack(tmpDir), 'go');
  });

  it('should detect python when pyproject.toml exists', () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]');
    assert.equal(detectStack(tmpDir), 'python');
  });

  it('should detect python when requirements.txt exists', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'flask');
    assert.equal(detectStack(tmpDir), 'python');
  });

  it('should detect python when setup.py exists', () => {
    writeFileSync(join(tmpDir, 'setup.py'), 'from setuptools import setup');
    assert.equal(detectStack(tmpDir), 'python');
  });

  it('should return generic when no manifest files found', () => {
    assert.equal(detectStack(tmpDir), 'generic');
  });

  it('should prefer node over python when both exist', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    writeFileSync(join(tmpDir, 'requirements.txt'), 'flask');
    assert.equal(detectStack(tmpDir), 'node');
  });
});

describe('detectArch', () => {
  it('should map x64 linux to x86_64-linux', () => {
    assert.equal(detectArch('x64', 'linux'), 'x86_64-linux');
  });

  it('should map arm64 linux to aarch64-linux', () => {
    assert.equal(detectArch('arm64', 'linux'), 'aarch64-linux');
  });

  it('should map x64 darwin to x86_64-darwin', () => {
    assert.equal(detectArch('x64', 'darwin'), 'x86_64-darwin');
  });

  it('should map arm64 darwin to aarch64-darwin', () => {
    assert.equal(detectArch('arm64', 'darwin'), 'aarch64-darwin');
  });

  it('should fall back to x86_64-linux for unknown arch', () => {
    assert.equal(detectArch('ia32', 'linux'), 'x86_64-linux');
  });

  it('should fall back to x86_64-linux for unknown platform', () => {
    assert.equal(detectArch('x64', 'win32'), 'x86_64-linux');
  });

  it('should fall back to x86_64-linux for unknown arch and platform', () => {
    assert.equal(detectArch('mips', 'freebsd'), 'x86_64-linux');
  });

  it('should use process.arch and process.platform when called without arguments', () => {
    const result = detectArch();
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('-'), 'result should be in format arch-platform');
  });
});

describe('generateFlakeContent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gen-flake-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate valid nix flake content for node project', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('nodejs_22'));
    assert.ok(content.includes('mkShell'));
    assert.ok(content.includes('nixpkgs'));
  });

  it('should respect node engine version from package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('nodejs_18'));
  });

  it('should generate rust flake with cargo and rustc', () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]');
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('rustc'));
    assert.ok(content.includes('cargo'));
  });

  it('should generate go flake', () => {
    writeFileSync(join(tmpDir, 'go.mod'), 'module example');
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('go'));
  });

  it('should generate python flake with uv', () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]');
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('python312'));
    assert.ok(content.includes('uv'));
  });

  it('should generate generic flake for unknown stack', () => {
    const content = generateFlakeContent(tmpDir);
    assert.ok(content.includes('mkShell'));
    assert.ok(content.includes('nixpkgs'));
  });
});

describe('ensureFlakeNix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ensure-flake-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate flake.nix when missing and return true', () => {
    const generated = ensureFlakeNix(tmpDir);
    assert.equal(generated, true);
    assert.ok(existsSync(join(tmpDir, 'flake.nix')));
  });

  it('should not overwrite existing flake.nix and return false', () => {
    const existing = '{ existing = true; }';
    writeFileSync(join(tmpDir, 'flake.nix'), existing);
    const generated = ensureFlakeNix(tmpDir);
    assert.equal(generated, false);
    assert.equal(readFileSync(join(tmpDir, 'flake.nix'), 'utf-8'), existing);
  });

  it('should detect stack and generate appropriate content', () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]');
    ensureFlakeNix(tmpDir);
    const content = readFileSync(join(tmpDir, 'flake.nix'), 'utf-8');
    assert.ok(content.includes('rustc'));
  });
});
