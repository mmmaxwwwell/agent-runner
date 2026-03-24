// SSH Agent Bridge — Unix socket proxy for SSH agent forwarding over WebSocket

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
import net from 'node:net';

import {
  MessageAccumulator,
  SSH_AGENT_FAILURE,
  SSH_AGENTC_REQUEST_IDENTITIES,
  SSH_AGENTC_SIGN_REQUEST,
  parseSignRequest,
} from './ssh-agent-protocol.ts';

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

interface PendingRequest {
  requestId: string;
  messageType: number;
  clientSocket: net.Socket;
  timeoutTimer: NodeJS.Timeout;
}

const WHITELISTED_TYPES = new Set([
  SSH_AGENTC_REQUEST_IDENTITIES, // 11
  SSH_AGENTC_SIGN_REQUEST,       // 13
]);

const FAILURE_RESPONSE = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);

export async function createBridge(options: CreateBridgeOptions): Promise<SSHAgentBridge> {
  const { sessionId, socketPath, remoteContext, onRequest, timeoutMs = 60000 } = options;
  const pendingRequests = new Map<string, PendingRequest>();

  // Remove stale socket if exists
  try {
    await unlink(socketPath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  const server = net.createServer((clientSocket) => {
    const accumulator = new MessageAccumulator();

    accumulator.onMessage((type, payload) => {
      if (!WHITELISTED_TYPES.has(type)) {
        clientSocket.write(FAILURE_RESPONSE);
        return;
      }

      const requestId = randomUUID();

      // Build context string
      let context: string;
      if (type === SSH_AGENTC_SIGN_REQUEST) {
        const parsed = parseSignRequest(payload);
        const parts = [`Sign request for git push to ${remoteContext}`];
        if (parsed?.username) parts.push(`user: ${parsed.username}`);
        if (parsed?.keyAlgorithm) parts.push(`algo: ${parsed.keyAlgorithm}`);
        context = parts.length > 1
          ? `${parts[0]} (${parts.slice(1).join(', ')})`
          : parts[0];
      } else {
        context = `List SSH keys for ${remoteContext}`;
      }

      // Build base64 data: type byte + payload (the full message body excluding length prefix)
      const messageBody = Buffer.concat([Buffer.from([type]), payload]);
      const data = messageBody.toString('base64');

      // Set up timeout
      const timeoutTimer = setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pendingRequests.delete(requestId);
          pending.clientSocket.write(FAILURE_RESPONSE);
        }
      }, timeoutMs);

      pendingRequests.set(requestId, {
        requestId,
        messageType: type,
        clientSocket,
        timeoutTimer,
      });

      onRequest({ requestId, messageType: type, context, data });
    });

    clientSocket.on('data', (chunk) => {
      accumulator.feed(chunk);
    });
  });

  // Start listening and wait for 'listening' event
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // Set socket permissions to 0600
  await chmod(socketPath, 0o600);

  const bridge: SSHAgentBridge = {
    sessionId,
    socketPath,

    handleResponse(requestId: string, data: Buffer): void {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;

      pendingRequests.delete(requestId);
      clearTimeout(pending.timeoutTimer);

      // data includes type byte + payload; wrap with 4-byte length prefix
      const lengthBuf = Buffer.alloc(4);
      lengthBuf.writeUInt32BE(data.length, 0);
      pending.clientSocket.write(Buffer.concat([lengthBuf, data]));
    },

    handleCancel(requestId: string): void {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;

      pendingRequests.delete(requestId);
      clearTimeout(pending.timeoutTimer);
      pending.clientSocket.write(FAILURE_RESPONSE);
    },

    async destroy(): Promise<void> {
      // Fail all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timeoutTimer);
        try {
          pending.clientSocket.write(FAILURE_RESPONSE);
        } catch {
          // Socket may already be closed
        }
        pendingRequests.delete(id);
      }

      // Close server
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      // Remove socket file
      try {
        await unlink(socketPath);
      } catch {
        // Already removed
      }
    },
  };

  return bridge;
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
