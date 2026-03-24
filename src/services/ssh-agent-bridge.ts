// SSH Agent Bridge — stub for TDD (T008)
// Real implementation will be added in T013

import { execFileSync } from 'node:child_process';
import type net from 'node:net';

export interface BridgeRequest {
  requestId: string;
  messageType: number;
  context: string;
  data: string; // base64
}

export interface CreateBridgeOptions {
  sessionId: string;
  socketPath: string;
  remoteContext: string;
  onRequest: (req: BridgeRequest) => void;
  timeoutMs?: number; // default 60000
}

export interface SSHAgentBridge {
  sessionId: string;
  socketPath: string;
  handleResponse(requestId: string, data: Buffer): void;
  handleCancel(requestId: string): void;
  destroy(): Promise<void>;
}

export async function createBridge(_options: CreateBridgeOptions): Promise<SSHAgentBridge> {
  throw new Error('createBridge not implemented — waiting for T013');
}

/**
 * Detect SSH remote URLs from a git repository.
 * Runs `git -C <dir> remote -v` and returns the first SSH remote URL found, or null.
 */
export function detectSSHRemote(projectDir: string): string | null {
  let output: string;
  try {
    output = execFileSync('git', ['-C', projectDir, 'remote', '-v'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return null;
  }

  for (const line of output.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const url = parts[1];
    // Match git@host:path or ssh://host/path
    if (/^git@[^:]+:.+/.test(url) || /^ssh:\/\//.test(url)) {
      return url;
    }
  }

  return null;
}
