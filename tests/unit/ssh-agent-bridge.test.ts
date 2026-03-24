import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

import { createBridge, type BridgeRequest, type SSHAgentBridge } from '../../src/services/ssh-agent-bridge.ts';
import {
  SSH_AGENT_FAILURE,
  SSH_AGENTC_REQUEST_IDENTITIES,
  SSH_AGENTC_SIGN_REQUEST,
  SSH_AGENT_IDENTITIES_ANSWER,
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

/** Build an SSH string: [4-byte BE length] [data] */
function buildSSHString(data: string | Buffer): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

/**
 * Build a SIGN_REQUEST payload with SSH userauth data.
 * Format: string key_blob, string data, uint32 flags
 * Data field (SSH userauth): string session_id, byte 50, string username,
 *   string service, string "publickey", boolean TRUE, string algorithm, string key_blob
 */
function buildSignRequestPayload(opts: {
  keyBlob?: Buffer;
  username?: string;
  algorithm?: string;
  useUserauthFormat?: boolean;
}): Buffer {
  const {
    keyBlob = Buffer.from('fake-key-blob'),
    username = 'git',
    algorithm = 'ecdsa-sha2-nistp256',
    useUserauthFormat = true,
  } = opts;

  let dataField: Buffer;
  if (useUserauthFormat) {
    // SSH userauth structure
    const sessionId = buildSSHString(Buffer.from('fake-session-id'));
    const marker = Buffer.from([50]); // SSH_MSG_USERAUTH_REQUEST
    const user = buildSSHString(username);
    const service = buildSSHString('ssh-connection');
    const method = buildSSHString('publickey');
    const boolTrue = Buffer.from([1]);
    const algo = buildSSHString(algorithm);
    const key = buildSSHString(keyBlob);
    dataField = Buffer.concat([sessionId, marker, user, service, method, boolTrue, algo, key]);
  } else {
    // Non-userauth format (opaque data)
    dataField = Buffer.from('opaque-non-userauth-data');
  }

  const flags = Buffer.alloc(4);
  flags.writeUInt32BE(0, 0);

  return Buffer.concat([buildSSHString(keyBlob), buildSSHString(dataField), flags]);
}

describe('SSHAgentBridge context generation', () => {
  let tmpDir: string;
  let socketPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ssh-bridge-context-'));
    socketPath = join(tmpDir, 'agent.sock');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

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

  it('should include remote, username, and algorithm in sign request context', async () => {
    const requests: BridgeRequest[] = [];

    const bridge = await createBridge({
      sessionId: 'context-sign-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        bridge.handleResponse(req.requestId, Buffer.from([14, 0]));
      },
    });

    try {
      const payload = buildSignRequestPayload({
        username: 'git',
        algorithm: 'ecdsa-sha2-nistp256',
      });
      const msg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);
      await sendAndReceive(socketPath, msg);

      assert.equal(requests.length, 1);
      assert.equal(
        requests[0].context,
        'Sign request for git push to github.com:user/repo.git (user: git, algo: ecdsa-sha2-nistp256)',
      );
    } finally {
      await bridge.destroy();
    }
  });

  it('should use list-keys context for REQUEST_IDENTITIES', async () => {
    const requests: BridgeRequest[] = [];

    const bridge = await createBridge({
      sessionId: 'context-list-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        bridge.handleResponse(req.requestId, Buffer.from([SSH_AGENT_IDENTITIES_ANSWER, 0, 0, 0, 0]));
      },
    });

    try {
      const msg = buildMessage(SSH_AGENTC_REQUEST_IDENTITIES, Buffer.alloc(0));
      await sendAndReceive(socketPath, msg);

      assert.equal(requests.length, 1);
      assert.equal(requests[0].context, 'List SSH keys for github.com:user/repo.git');
    } finally {
      await bridge.destroy();
    }
  });

  it('should omit user/algo from context when data is not SSH userauth format', async () => {
    const requests: BridgeRequest[] = [];

    const bridge = await createBridge({
      sessionId: 'context-fallback-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        bridge.handleResponse(req.requestId, Buffer.from([14, 0]));
      },
    });

    try {
      const payload = buildSignRequestPayload({ useUserauthFormat: false });
      const msg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);
      await sendAndReceive(socketPath, msg);

      assert.equal(requests.length, 1);
      // No user/algo should be present — just the base context
      assert.equal(
        requests[0].context,
        'Sign request for git push to github.com:user/repo.git',
      );
    } finally {
      await bridge.destroy();
    }
  });
});

describe('SSHAgentBridge WebSocket message routing', () => {
  let tmpDir: string;
  let socketPath: string;
  let bridge: SSHAgentBridge;
  const requests: BridgeRequest[] = [];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ssh-bridge-ws-routing-'));
    socketPath = join(tmpDir, 'agent.sock');
    requests.length = 0;
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.destroy();
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: connect to bridge socket, send a message, and wait for onRequest
   * callback WITHOUT auto-responding. Returns the pending requestId.
   */
  async function sendRequestAndCapture(
    path: string,
    type: number,
    payload: Buffer,
    capturedRequests: BridgeRequest[],
  ): Promise<{ requestId: string; client: net.Socket }> {
    const client = await new Promise<net.Socket>((resolve, reject) => {
      const sock = net.createConnection(path, () => resolve(sock));
      sock.on('error', reject);
    });
    client.write(buildMessage(type, payload));

    // Wait for onRequest callback to fire
    const start = Date.now();
    while (capturedRequests.length === 0 && Date.now() - start < 2000) {
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(capturedRequests.length > 0, 'Expected onRequest to be called');

    return { requestId: capturedRequests[capturedRequests.length - 1].requestId, client };
  }

  it('should route ssh-agent-response to correct bridge handleResponse', async () => {
    bridge = await createBridge({
      sessionId: 'ws-route-response-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
      timeoutMs: 5000,
    });

    // Send a REQUEST_IDENTITIES to create a pending request
    const { requestId, client } = await sendRequestAndCapture(
      socketPath,
      SSH_AGENTC_REQUEST_IDENTITIES,
      Buffer.alloc(0),
      requests,
    );

    // Simulate what the WebSocket handler does for ssh-agent-response:
    // decode base64 data and call bridge.handleResponse(requestId, data)
    const responseData = Buffer.from([SSH_AGENT_IDENTITIES_ANSWER, 0, 0, 0, 0]); // nkeys=0
    const base64Data = responseData.toString('base64');

    const socketResponse = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.on('data', (chunk) => {
        chunks.push(chunk);
        client.end();
      });
      client.on('end', () => resolve(Buffer.concat(chunks)));
      client.on('error', reject);

      // Route the response as the WebSocket handler would
      bridge.handleResponse(requestId, Buffer.from(base64Data, 'base64'));
    });

    // Verify the Unix socket received the response with length prefix
    const expectedLength = Buffer.alloc(4);
    expectedLength.writeUInt32BE(responseData.length, 0);
    const expected = Buffer.concat([expectedLength, responseData]);
    assert.deepEqual(socketResponse, expected, 'Socket should receive length-prefixed response');
  });

  it('should route ssh-agent-cancel to correct bridge handleCancel', async () => {
    bridge = await createBridge({
      sessionId: 'ws-route-cancel-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
      timeoutMs: 5000,
    });

    // Send a SIGN_REQUEST to create a pending request
    const payload = Buffer.alloc(20);
    const { requestId, client } = await sendRequestAndCapture(
      socketPath,
      SSH_AGENTC_SIGN_REQUEST,
      payload,
      requests,
    );

    // Simulate what the WebSocket handler does for ssh-agent-cancel
    const socketResponse = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.on('data', (chunk) => {
        chunks.push(chunk);
        client.end();
      });
      client.on('end', () => resolve(Buffer.concat(chunks)));
      client.on('error', reject);

      // Route the cancel as the WebSocket handler would
      bridge.handleCancel(requestId);
    });

    // Cancel should result in SSH_AGENT_FAILURE
    const expected = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);
    assert.deepEqual(socketResponse, expected, 'Cancel should return SSH_AGENT_FAILURE');
  });

  it('should silently drop ssh-agent-response with unknown requestId', async () => {
    bridge = await createBridge({
      sessionId: 'ws-route-unknown-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
      timeoutMs: 5000,
    });

    // Call handleResponse with a non-existent requestId — should not throw
    assert.doesNotThrow(() => {
      bridge.handleResponse('non-existent-request-id', Buffer.from([14, 0]));
    });
  });

  it('should silently drop ssh-agent-cancel with unknown requestId', async () => {
    bridge = await createBridge({
      sessionId: 'ws-route-unknown-2',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
      timeoutMs: 5000,
    });

    // Call handleCancel with a non-existent requestId — should not throw
    assert.doesNotThrow(() => {
      bridge.handleCancel('non-existent-request-id');
    });
  });
});
