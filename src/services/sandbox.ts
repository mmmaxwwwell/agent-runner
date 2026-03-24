import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export type SessionType = 'interview' | 'task-run';

export interface SandboxCommand {
  command: string;
  args: string[];
  unsandboxed: boolean;
}

export interface BuildCommandOptions {
  agentFrameworkDir: string;
  sandboxAvailable?: boolean;
  allowUnsandboxed?: boolean;
  prompt?: string;
}

const NIXPKGS = 'github:NixOS/nixpkgs/nixpkgs-unstable';
const CLAUDE_CODE_REF = `${NIXPKGS}#claude-code`;
const UV_REF = `${NIXPKGS}#uv`;

let _sandboxAvailable: boolean | null = null;

/**
 * Detect whether systemd-run is available on the system.
 */
export function isAvailable(): boolean {
  if (_sandboxAvailable !== null) return _sandboxAvailable;
  try {
    execFileSync('which', ['systemd-run'], { stdio: 'ignore' });
    _sandboxAvailable = true;
  } catch {
    _sandboxAvailable = false;
  }
  return _sandboxAvailable;
}

/**
 * Reset the cached availability check (for testing).
 */
export function resetAvailabilityCache(): void {
  _sandboxAvailable = null;
}

/**
 * Build the command array to spawn a sandboxed (or unsandboxed) agent process.
 */
export function buildCommand(
  projectDir: string,
  sessionType: SessionType,
  options: BuildCommandOptions,
): SandboxCommand {
  const { agentFrameworkDir, prompt } = options;
  const sandboxAvailable = options.sandboxAvailable ?? isAvailable();
  const allowUnsandboxed = options.allowUnsandboxed ?? false;

  // Validate: task-run requires a prompt
  if (sessionType === 'task-run' && !prompt) {
    throw new Error('Prompt is required for task-run sessions');
  }

  // Build claude args from session type preset
  const claudeArgs: string[] = [
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--model', 'opus',
  ];

  if (prompt) {
    claudeArgs.push('-p', prompt);
  }

  // Inner command: nix develop <projectDir> --command claude <args>
  const innerCommand = [
    'nix', 'develop', projectDir, '--command',
    'claude', ...claudeArgs,
  ];

  // Outer wrapper: nix shell --impure <refs> --command <innerCommand>
  // --impure required so NIXPKGS_ALLOW_UNFREE env var is respected (claude-code has unfree license)
  const nixShellCommand = [
    'shell', '--impure', CLAUDE_CODE_REF, UV_REF, '--command',
    ...innerCommand,
  ];

  if (sandboxAvailable) {
    const home = homedir();
    const bindPaths = [projectDir, `${home}/.cache/nix`, `${home}/.local/share/uv`].join(' ');

    const args = [
      '--user',
      '--pipe',
      '--setenv=NIXPKGS_ALLOW_UNFREE=1',
      '--property=ProtectHome=tmpfs',
      `--property=BindPaths=${bindPaths}`,
      `--property=BindReadOnlyPaths=${agentFrameworkDir}`,
      '--property=ProtectSystem=strict',
      '--property=NoNewPrivileges=yes',
      '--property=PrivateDevices=yes',
      '--property=PrivateTmp=yes',
      'nix',
      ...nixShellCommand,
    ];

    return { command: 'systemd-run', args, unsandboxed: false };
  }

  // Sandbox unavailable — check two-gate override
  const serverGate = process.env['ALLOW_UNSANDBOXED'] === 'true';

  if (!serverGate || !allowUnsandboxed) {
    throw new Error(
      'Sandbox (systemd-run) is unavailable. To run without sandbox, ' +
      'BOTH the server must be started with ALLOW_UNSANDBOXED=true ' +
      'AND the session request must include allowUnsandboxed: true.',
    );
  }

  return { command: 'nix', args: nixShellCommand, unsandboxed: true };
}
