import { execFileSync } from 'node:child_process';

export interface SandboxCommand {
  command: string;
  args: string[];
  unsandboxed: boolean;
}

interface BuildCommandOptions {
  sandboxAvailable?: boolean;
}

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
 *
 * Sandbox uses systemd-run --user --scope with filesystem isolation properties.
 * If sandbox is unavailable, requires two gates for unsandboxed execution:
 *   1. Server env var ALLOW_UNSANDBOXED=true
 *   2. Request param allowUnsandboxed=true
 *
 * Throws if sandbox is unavailable and both gates are not satisfied.
 */
export function buildCommand(
  projectDir: string,
  claudeArgs: string[],
  allowUnsandboxed: boolean,
  options?: BuildCommandOptions,
): SandboxCommand {
  const sandboxAvailable = options?.sandboxAvailable ?? isAvailable();

  if (sandboxAvailable) {
    // Use systemd-run sandbox regardless of unsandboxed gates
    const args = [
      '--user',
      '--scope',
      '--property=ProtectHome=tmpfs',
      `--property=BindPaths=${projectDir}`,
      '--property=ProtectSystem=strict',
      '--property=NoNewPrivileges=yes',
      '--property=PrivateDevices=yes',
      '--property=PrivateTmp=yes',
      'nix',
      'develop',
      projectDir,
      '--command',
      'claude',
      ...claudeArgs,
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

  // Both gates satisfied — run unsandboxed via nix develop
  const args = [
    'develop',
    projectDir,
    '--command',
    'claude',
    ...claudeArgs,
  ];

  return { command: 'nix', args, unsandboxed: true };
}
