import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

import { createBridge, type BridgeRequest } from '../../src/services/ssh-agent-bridge.ts';
import {
  SSH_AGENT_FAILURE,
  SSH_AGENTC_REQUEST_IDENTITIES,
  SSH_AGENTC_SIGN_REQUEST,
} from '../../src/services/ssh-agent-protocol.ts';

/** Build an SSH agent wire-format message: [4-byte BE length] [1-byte type] [payload] */
function buildMessage(type: number, payload: Buffer): Buffer {
  const length = 1 + payload.length;
  const buf = Buffer.alloc(4 + length);
  buf.writeUInt32BE(length, 0);
  buf[4] = type;
  payload.copy(buf, 5);
  return buf;
}

describe('SSHAgentBridge lifecycle', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ssh-bridge-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create a Unix socket at the correct path', async () => {
    const sessionId = 'test-session-1';
    const socketPath = join(tmpDir, 'agent.sock');

    const bridge = await createBridge({
      sessionId,
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: () => {},
    });

    try {
      const s = await stat(socketPath);
      assert.ok(s.isSocket(), 'Expected a Unix socket at socketPath');
    } finally {
      await bridge.destroy();
    }
  });

  it('should clean up socket file on destroy', async () => {
    const socketPath = join(tmpDir, 'agent.sock');

    const bridge = await createBridge({
      sessionId: 'test-session-2',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: () => {},
    });

    await bridge.destroy();

    await assert.rejects(stat(socketPath), { code: 'ENOENT' });
  });

  it('should remove stale socket before creation', async () => {
    const socketPath = join(tmpDir, 'agent.sock');

    // Create a stale socket file (just a regular file pretending to be old socket)
    await writeFile(socketPath, 'stale');

    const bridge = await createBridge({
      sessionId: 'test-session-3',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: () => {},
    });

    try {
      const s = await stat(socketPath);
      assert.ok(s.isSocket(), 'Expected a Unix socket, not the stale file');
    } finally {
      await bridge.destroy();
    }
  });

  it('should set socket permissions to 0600', async () => {
    const socketPath = join(tmpDir, 'agent.sock');

    const bridge = await createBridge({
      sessionId: 'test-session-4',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: () => {},
    });

    try {
      const s = await stat(socketPath);
      // mode & 0o777 gives the permission bits
      const perms = s.mode & 0o777;
      assert.equal(perms, 0o600, `Expected 0600 permissions, got ${perms.toString(8)}`);
    } finally {
      await bridge.destroy();
    }
  });

  it('should timeout pending requests and return FAILURE', async () => {
    const socketPath = join(tmpDir, 'agent.sock');
    const requests: Array<{ requestId: string; messageType: number }> = [];

    const bridge = await createBridge({
      sessionId: 'test-session-5',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
      timeoutMs: 100, // Use short timeout for testing
    });

    try {
      // Connect to the Unix socket and send a sign request
      const response = await new Promise<Buffer>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          // Build a minimal SIGN_REQUEST (type 13) message
          const payload = Buffer.alloc(20); // minimal payload
          client.write(buildMessage(SSH_AGENTC_SIGN_REQUEST, payload));
        });

        const chunks: Buffer[] = [];
        client.on('data', (chunk) => {
          chunks.push(chunk);
          client.end();
        });
        client.on('end', () => resolve(Buffer.concat(chunks)));
        client.on('error', reject);
      });

      // Should have received a request via onRequest callback
      assert.equal(requests.length, 1);
      assert.equal(requests[0].messageType, SSH_AGENTC_SIGN_REQUEST);

      // Response should be SSH_AGENT_FAILURE: [0,0,0,1,5]
      const expected = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);
      assert.deepEqual(response, expected, 'Expected SSH_AGENT_FAILURE response after timeout');
    } finally {
      await bridge.destroy();
    }
  });
});

describe('SSHAgentBridge message type whitelisting', () => {
  let tmpDir: string;
  let socketPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ssh-bridge-whitelist-'));
    socketPath = join(tmpDir, 'agent.sock');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: send a message to the bridge socket and collect the response.
   * Resolves on first data event (bridge writes complete messages atomically).
   */
  function sendAndReceive(path: string, data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(path, () => {
        client.write(data);
      });
      client.on('data', (chunk) => {
        client.end();
        resolve(chunk);
      });
      client.on('error', reject);
    });
  }

  const FAILURE_RESPONSE = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);

  // Non-whitelisted message types per SSH agent protocol
  const nonWhitelistedTypes = [
    { type: 17, name: 'ADD_IDENTITY' },
    { type: 18, name: 'REMOVE_IDENTITY' },
    { type: 19, name: 'REMOVE_ALL_IDENTITIES' },
    { type: 22, name: 'LOCK' },
    { type: 23, name: 'UNLOCK' },
  ];

  for (const { type, name } of nonWhitelistedTypes) {
    it(`should reject ${name} (type ${type}) with FAILURE without triggering onRequest`, async () => {
      const requests: BridgeRequest[] = [];

      const bridge = await createBridge({
        sessionId: `whitelist-reject-${type}`,
        socketPath,
        remoteContext: 'github.com:user/repo.git',
        onRequest: (req) => { requests.push(req); },
      });

      try {
        const msg = buildMessage(type, Buffer.from('test-payload'));
        const response = await sendAndReceive(socketPath, msg);

        assert.equal(requests.length, 0, `${name} should NOT trigger onRequest`);
        assert.deepEqual(response, FAILURE_RESPONSE, `${name} should return SSH_AGENT_FAILURE`);
      } finally {
        await bridge.destroy();
      }
    });
  }

  it('should allow REQUEST_IDENTITIES (type 11) and trigger onRequest', async () => {
    const requests: BridgeRequest[] = [];

    const bridge = await createBridge({
      sessionId: 'whitelist-allow-11',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        // Respond immediately to unblock the socket
        bridge.handleResponse(req.requestId, Buffer.from([12, 0, 0, 0, 0])); // IDENTITIES_ANSWER, nkeys=0
      },
    });

    try {
      const msg = buildMessage(SSH_AGENTC_REQUEST_IDENTITIES, Buffer.alloc(0));
      const response = await sendAndReceive(socketPath, msg);

      assert.equal(requests.length, 1, 'REQUEST_IDENTITIES should trigger onRequest');
      assert.equal(requests[0].messageType, SSH_AGENTC_REQUEST_IDENTITIES);
      // Response should NOT be FAILURE
      assert.notDeepEqual(response, FAILURE_RESPONSE, 'Whitelisted type should not return FAILURE');
    } finally {
      await bridge.destroy();
    }
  });

  it('should allow SIGN_REQUEST (type 13) and trigger onRequest', async () => {
    const requests: BridgeRequest[] = [];

    const bridge = await createBridge({
      sessionId: 'whitelist-allow-13',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        // Respond immediately to unblock the socket
        bridge.handleResponse(req.requestId, Buffer.from([14, 0])); // SIGN_RESPONSE + minimal payload
      },
    });

    try {
      // Build minimal sign request payload
      const payload = Buffer.alloc(20);
      const msg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);
      const response = await sendAndReceive(socketPath, msg);

      assert.equal(requests.length, 1, 'SIGN_REQUEST should trigger onRequest');
      assert.equal(requests[0].messageType, SSH_AGENTC_SIGN_REQUEST);
      assert.notDeepEqual(response, FAILURE_RESPONSE, 'Whitelisted type should not return FAILURE');
    } finally {
      await bridge.destroy();
    }
  });
});
