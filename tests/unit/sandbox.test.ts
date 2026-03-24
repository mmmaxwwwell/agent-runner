import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';

// The module under test — will be implemented in T024
import { buildCommand, isAvailable } from '../../src/services/sandbox.ts';

describe('sandbox', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  describe('buildCommand (new signature — session-type presets)', () => {
    const projectDir = '/home/user/my-project';
    const agentFrameworkDir = '/home/user/.local/share/agent-runner/agent-framework';
    const defaultOpts = { agentFrameworkDir, sandboxAvailable: true };
    const home = homedir();

    // Helper to get args after 'claude' in the command
    function getClaudeArgs(args: string[]): string[] {
      const claudeIdx = args.lastIndexOf('claude');
      return claudeIdx === -1 ? [] : args.slice(claudeIdx + 1);
    }

    describe('common preset flags', () => {
      it('should include --output-format stream-json for interview sessions', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--output-format'), 'Missing --output-format flag');
        const fmtIdx = claudeArgs.indexOf('--output-format');
        assert.equal(claudeArgs[fmtIdx + 1], 'stream-json', 'output-format should be stream-json');
      });

      it('should include --output-format stream-json for task-run sessions', () => {
        const result = buildCommand(projectDir, 'task-run', { ...defaultOpts, prompt: 'do the task' });
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--output-format'), 'Missing --output-format flag');
        const fmtIdx = claudeArgs.indexOf('--output-format');
        assert.equal(claudeArgs[fmtIdx + 1], 'stream-json');
      });

      it('should include --dangerously-skip-permissions for interview sessions', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--dangerously-skip-permissions'), 'Missing --dangerously-skip-permissions');
      });

      it('should include --dangerously-skip-permissions for task-run sessions', () => {
        const result = buildCommand(projectDir, 'task-run', { ...defaultOpts, prompt: 'do the task' });
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--dangerously-skip-permissions'), 'Missing --dangerously-skip-permissions');
      });

      it('should include --model opus for interview sessions', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--model'), 'Missing --model flag');
        const modelIdx = claudeArgs.indexOf('--model');
        assert.equal(claudeArgs[modelIdx + 1], 'opus');
      });

      it('should include --model opus for task-run sessions', () => {
        const result = buildCommand(projectDir, 'task-run', { ...defaultOpts, prompt: 'do the task' });
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('--model'), 'Missing --model flag');
        const modelIdx = claudeArgs.indexOf('--model');
        assert.equal(claudeArgs[modelIdx + 1], 'opus');
      });
    });

    describe('interview session type', () => {
      it('should support optional -p flag when prompt is provided', () => {
        const prompt = 'Interview the user about their project';
        const result = buildCommand(projectDir, 'interview', { ...defaultOpts, prompt });
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('-p'), 'Missing -p flag when prompt is provided');
        const pIdx = claudeArgs.indexOf('-p');
        assert.equal(claudeArgs[pIdx + 1], prompt);
      });

      it('should not include -p flag when no prompt is provided', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(!claudeArgs.includes('-p'), '-p flag should not be present without prompt');
      });
    });

    describe('task-run session type', () => {
      it('should require -p flag with prompt', () => {
        const prompt = 'Execute the task plan';
        const result = buildCommand(projectDir, 'task-run', { ...defaultOpts, prompt });
        const claudeArgs = getClaudeArgs(result.args);
        assert.ok(claudeArgs.includes('-p'), 'Missing -p flag for task-run');
        const pIdx = claudeArgs.indexOf('-p');
        assert.equal(claudeArgs[pIdx + 1], prompt);
      });

      it('should throw when task-run has no prompt', () => {
        assert.throws(
          () => buildCommand(projectDir, 'task-run', defaultOpts),
          /prompt.*required|required.*prompt/i,
          'task-run without prompt should throw',
        );
      });
    });

    describe('sandbox BindPaths', () => {
      it('should include ~/.cache/nix in BindPaths', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const bindProp = result.args.find(a => a.startsWith('--property=BindPaths='));
        assert.ok(bindProp, 'Missing BindPaths property');
        assert.ok(
          bindProp!.includes(`${home}/.cache/nix`),
          `BindPaths should include ${home}/.cache/nix`,
        );
      });

      it('should include ~/.local/share/uv in BindPaths', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const bindProp = result.args.find(a => a.startsWith('--property=BindPaths='));
        assert.ok(bindProp, 'Missing BindPaths property');
        assert.ok(
          bindProp!.includes(`${home}/.local/share/uv`),
          `BindPaths should include ${home}/.local/share/uv`,
        );
      });

      it('should include project directory in BindPaths', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const bindProp = result.args.find(a => a.startsWith('--property=BindPaths='));
        assert.ok(bindProp, 'Missing BindPaths property');
        assert.ok(bindProp!.includes(projectDir), 'BindPaths should include project directory');
      });
    });

    describe('sandbox BindReadOnlyPaths', () => {
      it('should include agentFrameworkDir in BindReadOnlyPaths', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);
        const bindROProp = result.args.find(a => a.startsWith('--property=BindReadOnlyPaths='));
        assert.ok(bindROProp, 'Missing BindReadOnlyPaths property');
        assert.ok(
          bindROProp!.includes(agentFrameworkDir),
          'BindReadOnlyPaths should include agentFrameworkDir',
        );
      });
    });

    describe('nix shell wrapper', () => {
      it('should wrap inner command with nix shell for claude-code and uv', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);

        // Find 'nix' 'shell' in args (the outer nix shell wrapper)
        const shellIdx = result.args.indexOf('shell');
        assert.ok(shellIdx !== -1, 'Missing nix shell in args');
        assert.equal(result.args[shellIdx - 1], 'nix', 'shell should be preceded by nix');

        // Should include claude-code and uv flake refs
        const claudeCodeRef = result.args.find(a => a.includes('nixpkgs') && a.includes('claude-code'));
        assert.ok(claudeCodeRef, 'Missing claude-code nix flake reference');

        const uvRef = result.args.find(a => a.includes('nixpkgs') && a.includes('#uv'));
        assert.ok(uvRef, 'Missing uv nix flake reference');
      });

      it('should have nix develop inside the nix shell --command', () => {
        const result = buildCommand(projectDir, 'interview', defaultOpts);

        // Structure: ... nix shell <refs> --command nix develop <projectDir> --command claude ...
        const args = result.args;
        const shellIdx = args.indexOf('shell');
        assert.ok(shellIdx !== -1, 'Missing shell');

        // Find --command after shell (the nix shell's --command)
        const shellCommandIdx = args.indexOf('--command', shellIdx);
        assert.ok(shellCommandIdx !== -1, 'Missing --command after nix shell');

        // After --command should be nix develop
        assert.equal(args[shellCommandIdx + 1], 'nix', 'Inner command should start with nix');
        assert.equal(args[shellCommandIdx + 2], 'develop', 'Inner command should be nix develop');
        assert.equal(args[shellCommandIdx + 3], projectDir, 'nix develop should target project dir');

        // Then --command claude
        const innerCommandIdx = args.indexOf('--command', shellCommandIdx + 1);
        assert.ok(innerCommandIdx !== -1, 'Missing inner --command for claude');
        assert.equal(args[innerCommandIdx + 1], 'claude', 'Inner --command should invoke claude');
      });
    });

    describe('unsandboxed mode (new signature)', () => {
      it('should use nix shell wrapper even when unsandboxed', () => {
        process.env['ALLOW_UNSANDBOXED'] = 'true';
        const result = buildCommand(projectDir, 'interview', {
          agentFrameworkDir,
          sandboxAvailable: false,
          allowUnsandboxed: true,
        });

        assert.equal(result.command, 'nix');
        assert.equal(result.args[0], 'shell');
        assert.equal(result.unsandboxed, true);
      });

      it('should throw when sandbox unavailable and allowUnsandboxed not set', () => {
        process.env['ALLOW_UNSANDBOXED'] = 'false';
        assert.throws(
          () => buildCommand(projectDir, 'interview', {
            agentFrameworkDir,
            sandboxAvailable: false,
          }),
          /sandbox/i,
        );
      });
    });
  });

  describe('buildCommand (sandbox properties — new signature)', () => {
    const projectDir = '/home/user/my-project';
    const agentFrameworkDir = '/home/user/.local/share/agent-runner/agent-framework';
    const sandboxedOpts = { agentFrameworkDir, sandboxAvailable: true };

    it('should return systemd-run command with sandbox properties when available', () => {
      const result = buildCommand(projectDir, 'interview', sandboxedOpts);

      assert.equal(result.command, 'systemd-run');
      assert.ok(result.args.includes('--user'));
      assert.ok(result.args.includes('--pipe'));
    });

    it('should include ProtectHome=tmpfs property', () => {
      const result = buildCommand(projectDir, 'interview', sandboxedOpts);
      const propIndex = result.args.indexOf('--property=ProtectHome=tmpfs');
      assert.ok(propIndex !== -1, 'Missing ProtectHome=tmpfs property');
    });

    it('should include ProtectSystem=strict property', () => {
      const result = buildCommand(projectDir, 'interview', sandboxedOpts);
      const prop = result.args.find(a => a === '--property=ProtectSystem=strict');
      assert.ok(prop, 'Missing ProtectSystem=strict property');
    });

    it('should include NoNewPrivileges=yes property', () => {
      const result = buildCommand(projectDir, 'interview', sandboxedOpts);
      const prop = result.args.find(a => a === '--property=NoNewPrivileges=yes');
      assert.ok(prop, 'Missing NoNewPrivileges=yes property');
    });

    it('should include project directory in nix develop command', () => {
      const result = buildCommand(projectDir, 'interview', sandboxedOpts);

      const nixIndex = result.args.indexOf('nix');
      const developIndex = result.args.indexOf('develop', nixIndex);
      assert.equal(result.args[developIndex + 1], projectDir);
    });
  });

  describe('buildCommand (two-gate unsandboxed logic)', () => {
    const agentFrameworkDir = '/home/user/.local/share/agent-runner/agent-framework';

    it('should throw when ALLOW_UNSANDBOXED env is not true but allowUnsandboxed param is true', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'false';

      assert.throws(
        () => buildCommand('/home/user/project', 'interview', {
          agentFrameworkDir,
          sandboxAvailable: false,
          allowUnsandboxed: true,
        }),
        /sandbox/i,
        'Should reject when server gate (ALLOW_UNSANDBOXED) is not set'
      );
    });

    it('should throw when ALLOW_UNSANDBOXED env is true but allowUnsandboxed param is false', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      assert.throws(
        () => buildCommand('/home/user/project', 'interview', {
          agentFrameworkDir,
          sandboxAvailable: false,
          allowUnsandboxed: false,
        }),
        /sandbox/i,
        'Should reject when request gate (allowUnsandboxed) is not set'
      );
    });

    it('should allow unsandboxed when both gates are satisfied', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      const result = buildCommand('/home/user/project', 'interview', {
        agentFrameworkDir,
        sandboxAvailable: false,
        allowUnsandboxed: true,
      });

      assert.equal(result.command, 'nix');
      assert.ok(result.args.includes('develop'));
      assert.ok(result.args.includes('--command'));
    });

    it('should include unsandboxed warning flag when running without sandbox', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      const result = buildCommand('/home/user/project', 'interview', {
        agentFrameworkDir,
        sandboxAvailable: false,
        allowUnsandboxed: true,
      });

      assert.equal(result.unsandboxed, true);
    });

    it('should not set unsandboxed flag when sandbox is available', () => {
      const result = buildCommand('/home/user/project', 'interview', {
        agentFrameworkDir,
        sandboxAvailable: true,
      });

      assert.equal(result.unsandboxed, false);
    });

    it('should prefer sandbox even when both unsandboxed gates are open', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      const result = buildCommand('/home/user/project', 'interview', {
        agentFrameworkDir,
        sandboxAvailable: true,
        allowUnsandboxed: true,
      });

      assert.equal(result.command, 'systemd-run');
      assert.equal(result.unsandboxed, false);
    });

    it('should throw when sandbox unavailable and neither gate is set', () => {
      process.env['ALLOW_UNSANDBOXED'] = 'false';

      assert.throws(
        () => buildCommand('/home/user/project', 'interview', {
          agentFrameworkDir,
          sandboxAvailable: false,
          allowUnsandboxed: false,
        }),
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
