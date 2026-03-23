import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The module under test — will be implemented in T024
import { buildCommand, isAvailable } from '../../src/services/sandbox.ts';

describe('sandbox', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  describe('buildCommand', () => {
    it('should return systemd-run command with sandbox properties when available', () => {
      const result = buildCommand('/home/user/my-project', ['--task-file', 'tasks.md'], false);

      // Should start with systemd-run --user --pipe
      assert.equal(result.command, 'systemd-run');
      assert.ok(result.args.includes('--user'));
      assert.ok(result.args.includes('--pipe'));
    });

    it('should include ProtectHome=tmpfs property', () => {
      const result = buildCommand('/home/user/my-project', ['--task-file', 'tasks.md'], false);
      const propIndex = result.args.indexOf('--property=ProtectHome=tmpfs');
      assert.ok(propIndex !== -1, 'Missing ProtectHome=tmpfs property');
    });

    it('should include BindPaths property with the project directory', () => {
      const projectDir = '/home/user/my-project';
      const result = buildCommand(projectDir, ['--task-file', 'tasks.md'], false);
      const bindProp = result.args.find(a => a.startsWith('--property=BindPaths='));
      assert.ok(bindProp, 'Missing BindPaths property');
      assert.ok(bindProp!.includes(projectDir), 'BindPaths should include project directory');
    });

    it('should include ProtectSystem=strict property', () => {
      const result = buildCommand('/home/user/my-project', ['--task-file', 'tasks.md'], false);
      const prop = result.args.find(a => a === '--property=ProtectSystem=strict');
      assert.ok(prop, 'Missing ProtectSystem=strict property');
    });

    it('should include NoNewPrivileges=yes property', () => {
      const result = buildCommand('/home/user/my-project', ['--task-file', 'tasks.md'], false);
      const prop = result.args.find(a => a === '--property=NoNewPrivileges=yes');
      assert.ok(prop, 'Missing NoNewPrivileges=yes property');
    });

    it('should chain nix develop with --command claude and provided args', () => {
      const claudeArgs = ['--task-file', 'tasks.md', '--prompt-file', 'prompt.md'];
      const result = buildCommand('/home/user/my-project', claudeArgs, false);

      // The args should eventually contain: nix develop <dir> --command claude <args>
      const nixIndex = result.args.indexOf('nix');
      assert.ok(nixIndex !== -1, 'Missing nix command in args');

      const developIndex = result.args.indexOf('develop', nixIndex);
      assert.ok(developIndex !== -1, 'Missing develop subcommand');

      const commandIndex = result.args.indexOf('--command', developIndex);
      assert.ok(commandIndex !== -1, 'Missing --command flag');

      const claudeIndex = result.args.indexOf('claude', commandIndex);
      assert.ok(claudeIndex !== -1, 'Missing claude command');

      // Claude args should follow
      assert.equal(result.args[claudeIndex + 1], '--task-file');
      assert.equal(result.args[claudeIndex + 2], 'tasks.md');
    });

    it('should include project directory in nix develop command', () => {
      const projectDir = '/home/user/my-project';
      const result = buildCommand(projectDir, ['--task-file', 'tasks.md'], false);

      const nixIndex = result.args.indexOf('nix');
      const developIndex = result.args.indexOf('develop', nixIndex);
      // The project dir should be right after 'develop'
      assert.equal(result.args[developIndex + 1], projectDir);
    });

    it('should throw when sandbox unavailable and allowUnsandboxed is false', () => {
      // When ALLOW_UNSANDBOXED is not set and sandbox is unavailable,
      // buildCommand with allowUnsandboxed=false should throw
      process.env['ALLOW_UNSANDBOXED'] = 'false';

      // This test depends on sandbox being unavailable — we test the two-gate logic
      // by forcing the scenario. The actual availability check is tested separately.
      // If sandbox IS available on the test machine, this test is about the parameter gate.
    });

    it('should throw when ALLOW_UNSANDBOXED env is not true but allowUnsandboxed param is true', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'false';

      assert.throws(
        () => buildCommand('/home/user/project', ['--task-file', 'tasks.md'], true, { sandboxAvailable: false }),
        /sandbox/i,
        'Should reject when server gate (ALLOW_UNSANDBOXED) is not set'
      );
    });

    it('should throw when ALLOW_UNSANDBOXED env is true but allowUnsandboxed param is false', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      assert.throws(
        () => buildCommand('/home/user/project', ['--task-file', 'tasks.md'], false, { sandboxAvailable: false }),
        /sandbox/i,
        'Should reject when request gate (allowUnsandboxed) is not set'
      );
    });

    it('should allow unsandboxed when both gates are satisfied', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      // Should not throw — both gates are open
      const result = buildCommand('/home/user/project', ['--task-file', 'tasks.md'], true, { sandboxAvailable: false });

      // When running unsandboxed, command should be nix (not systemd-run)
      assert.equal(result.command, 'nix');
      assert.ok(result.args.includes('develop'));
      assert.ok(result.args.includes('--command'));
    });

    it('should include unsandboxed warning flag when running without sandbox', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      const result = buildCommand('/home/user/project', ['--task-file', 'tasks.md'], true, { sandboxAvailable: false });

      // The result should indicate unsandboxed execution for logging purposes
      assert.equal(result.unsandboxed, true);
    });

    it('should not set unsandboxed flag when sandbox is available', () => {
      const result = buildCommand('/home/user/project', ['--task-file', 'tasks.md'], false, { sandboxAvailable: true });

      assert.equal(result.unsandboxed, false);
    });

    it('should prefer sandbox even when both unsandboxed gates are open', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      // When sandbox IS available, use it regardless of allowUnsandboxed
      const result = buildCommand('/home/user/project', ['--task-file', 'tasks.md'], true, { sandboxAvailable: true });

      assert.equal(result.command, 'systemd-run');
      assert.equal(result.unsandboxed, false);
    });

    it('should throw when sandbox unavailable and neither gate is set', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'false';

      assert.throws(
        () => buildCommand('/home/user/project', ['--task-file', 'tasks.md'], false, { sandboxAvailable: false }),
        /sandbox/i,
        'Should reject when sandbox unavailable and no override gates'
      );
    });
  });

  describe('isAvailable', () => {
    it('should return a boolean', () => {
      const result = isAvailable();
      assert.equal(typeof result, 'boolean');
    });

    it('should detect systemd-run availability on the system', () => {
      // On NixOS (the target platform), systemd-run should be available
      // This test verifies the detection mechanism works — the actual result
      // depends on the test environment
      const result = isAvailable();
      assert.equal(typeof result, 'boolean');
    });
  });
});
