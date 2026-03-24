import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

import { createBridge, type BridgeRequest, type SSHAgentBridge } from '../../src/services/ssh-agent-bridge.ts';
import {
  SSH_AGENT_FAILURE,
  SSH_AGENTC_REQUEST_IDENTITIES,
  SSH_AGENT_IDENTITIES_ANSWER,
  SSH_AGENTC_SIGN_REQUEST,
  SSH_AGENT_SIGN_RESPONSE,
} from '../../src/services/ssh-agent-protocol.ts';

/** Build an SSH agent wire-format message: [4-byte BE length] [1-byte type] [payload] */
function buildMessage(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const length = 1 + payload.length;
  const buf = Buffer.alloc(4 + length);
  buf.writeUInt32BE(length, 0);
  buf[4] = type;
  payload.copy(buf, 5);
  return buf;
}

/** Build a wire-format response message (what the bridge should write back to the Unix socket) */
function buildResponseMessage(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return buildMessage(type, payload);
}

/**
 * Connect to a Unix socket, send data, and collect the response.
 * Returns the full response buffer once the server side finishes writing.
 */
function sendToSocket(socketPath: string, data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(data);
    });
    const chunks: Buffer[] = [];
    client.on('data', (chunk) => chunks.push(chunk));
    client.on('end', () => resolve(Buffer.concat(chunks)));
    client.on('error', reject);
  });
}

/**
 * Connect to a Unix socket, send data, wait for a response, then close.
 * Unlike sendToSocket, this resolves after receiving the first chunk of data,
 * since the bridge writes a complete message at once.
 */
function sendAndReceive(socketPath: string, data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(data);
    });
    client.on('data', (chunk) => {
      client.end();
      resolve(chunk);
    });
    client.on('error', reject);
  });
}

describe('SSH Agent Bridge integration', () => {
  let tmpDir: string;
  let socketPath: string;
  let bridge: SSHAgentBridge | null = null;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ssh-bridge-integ-'));
    socketPath = join(tmpDir, 'agent.sock');
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.destroy();
      bridge = null;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should forward REQUEST_IDENTITIES to onRequest and relay response back to socket', async () => {
    const requests: BridgeRequest[] = [];

    bridge = await createBridge({
      sessionId: 'integ-session-1',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        // Simulate client responding with IDENTITIES_ANSWER
        // Build a simple identities answer: nkeys=0
        const answerPayload = Buffer.alloc(4); // uint32 nkeys = 0
        const responseData = Buffer.concat([Buffer.from([SSH_AGENT_IDENTITIES_ANSWER]), answerPayload]);
        bridge!.handleResponse(req.requestId, responseData);
      },
    });

    // Connect to the Unix socket and send REQUEST_IDENTITIES (type 11, no payload)
    const requestMsg = buildMessage(SSH_AGENTC_REQUEST_IDENTITIES);
    const response = await sendAndReceive(socketPath, requestMsg);

    // Verify onRequest was called
    assert.equal(requests.length, 1);
    assert.equal(requests[0].messageType, SSH_AGENTC_REQUEST_IDENTITIES);
    assert.ok(requests[0].requestId, 'requestId should be set');
    assert.ok(requests[0].context, 'context should be set');
    assert.ok(requests[0].data, 'data should be base64 encoded message');

    // Verify the Unix socket received the relayed response
    // Response should be the full wire-format message
    const expectedLength = 1 + 4; // type byte + nkeys uint32
    assert.equal(response.readUInt32BE(0), expectedLength, 'Response length prefix');
    assert.equal(response[4], SSH_AGENT_IDENTITIES_ANSWER, 'Response type should be IDENTITIES_ANSWER');
  });

  it('should forward SIGN_REQUEST to onRequest and relay response back to socket', async () => {
    const requests: BridgeRequest[] = [];

    bridge = await createBridge({
      sessionId: 'integ-session-2',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        // Simulate client responding with SIGN_RESPONSE
        // Build a minimal sign response: type 14 + signature blob
        const sigBlob = Buffer.from('mock-signature');
        const responseData = Buffer.concat([Buffer.from([SSH_AGENT_SIGN_RESPONSE]), sigBlob]);
        bridge!.handleResponse(req.requestId, responseData);
      },
    });

    // Build a sign request payload: SSH string key_blob + SSH string data + uint32 flags
    const keyBlob = Buffer.from('mock-key');
    const dataToSign = Buffer.from('mock-data');
    const payload = Buffer.alloc(4 + keyBlob.length + 4 + dataToSign.length + 4);
    let offset = 0;
    payload.writeUInt32BE(keyBlob.length, offset); offset += 4;
    keyBlob.copy(payload, offset); offset += keyBlob.length;
    payload.writeUInt32BE(dataToSign.length, offset); offset += 4;
    dataToSign.copy(payload, offset); offset += dataToSign.length;
    payload.writeUInt32BE(0, offset); // flags = 0

    const requestMsg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);
    const response = await sendAndReceive(socketPath, requestMsg);

    // Verify onRequest was called with sign request details
    assert.equal(requests.length, 1);
    assert.equal(requests[0].messageType, SSH_AGENTC_SIGN_REQUEST);
    assert.ok(requests[0].requestId, 'requestId should be set');

    // Verify response was relayed back
    const respLength = response.readUInt32BE(0);
    assert.equal(response[4], SSH_AGENT_SIGN_RESPONSE, 'Response type should be SIGN_RESPONSE');
    // Response payload should contain the signature
    const respPayload = response.subarray(5, 4 + respLength);
    assert.deepEqual(respPayload, Buffer.from('mock-signature'));
  });

  it('should return FAILURE when cancel is called on a pending request', async () => {
    const requests: BridgeRequest[] = [];

    bridge = await createBridge({
      sessionId: 'integ-session-3',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => {
        requests.push(req);
        // Simulate client cancelling the request
        bridge!.handleCancel(req.requestId);
      },
    });

    // Send a sign request
    const payload = Buffer.alloc(20); // minimal payload
    const requestMsg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);
    const response = await sendAndReceive(socketPath, requestMsg);

    // Verify onRequest was called
    assert.equal(requests.length, 1);

    // Response should be SSH_AGENT_FAILURE: [0,0,0,1,5]
    const expected = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);
    assert.deepEqual(response, expected, 'Cancel should return SSH_AGENT_FAILURE');
  });

  it('should isolate concurrent bridges — responses route to correct sockets', async () => {
    // Create two bridges with different session IDs and socket paths
    const socketPath2 = join(tmpDir, 'agent2.sock');
    const requests1: BridgeRequest[] = [];
    const requests2: BridgeRequest[] = [];

    bridge = await createBridge({
      sessionId: 'concurrent-session-1',
      socketPath,
      remoteContext: 'github.com:user/repo-alpha.git',
      onRequest: (req) => { requests1.push(req); },
    });

    const bridge2 = await createBridge({
      sessionId: 'concurrent-session-2',
      socketPath: socketPath2,
      remoteContext: 'github.com:user/repo-beta.git',
      onRequest: (req) => { requests2.push(req); },
    });

    try {
      // Build sign request payloads
      const keyBlob = Buffer.from('mock-key');
      const dataToSign = Buffer.from('mock-data');
      const payload = Buffer.alloc(4 + keyBlob.length + 4 + dataToSign.length + 4);
      let offset = 0;
      payload.writeUInt32BE(keyBlob.length, offset); offset += 4;
      keyBlob.copy(payload, offset); offset += keyBlob.length;
      payload.writeUInt32BE(dataToSign.length, offset); offset += 4;
      dataToSign.copy(payload, offset); offset += dataToSign.length;
      payload.writeUInt32BE(0, offset);

      const signMsg = buildMessage(SSH_AGENTC_SIGN_REQUEST, payload);

      // Send sign requests to both bridges concurrently — but don't respond yet
      // We need to connect and send without waiting for response, so we handle responses manually
      const response1Promise = new Promise<Buffer>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          client.write(signMsg);
        });
        client.on('data', (chunk) => { client.end(); resolve(chunk); });
        client.on('error', reject);
      });

      const response2Promise = new Promise<Buffer>((resolve, reject) => {
        const client = net.createConnection(socketPath2, () => {
          client.write(signMsg);
        });
        client.on('data', (chunk) => { client.end(); resolve(chunk); });
        client.on('error', reject);
      });

      // Wait for both onRequest callbacks to fire
      await new Promise<void>((resolve) => {
        const check = () => {
          if (requests1.length >= 1 && requests2.length >= 1) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      // Verify each bridge got exactly one request
      assert.equal(requests1.length, 1);
      assert.equal(requests2.length, 1);
      assert.notEqual(requests1[0].requestId, requests2[0].requestId, 'Request IDs should differ');

      // Respond with different data to each bridge
      const sig1 = Buffer.from('signature-for-alpha');
      const responseData1 = Buffer.concat([Buffer.from([SSH_AGENT_SIGN_RESPONSE]), sig1]);
      bridge.handleResponse(requests1[0].requestId, responseData1);

      const sig2 = Buffer.from('signature-for-beta');
      const responseData2 = Buffer.concat([Buffer.from([SSH_AGENT_SIGN_RESPONSE]), sig2]);
      bridge2.handleResponse(requests2[0].requestId, responseData2);

      // Collect responses
      const [resp1, resp2] = await Promise.all([response1Promise, response2Promise]);

      // Verify bridge 1 got the alpha signature
      const respPayload1 = resp1.subarray(5, 4 + resp1.readUInt32BE(0));
      assert.deepEqual(respPayload1, sig1, 'Bridge 1 should receive alpha signature');

      // Verify bridge 2 got the beta signature
      const respPayload2 = resp2.subarray(5, 4 + resp2.readUInt32BE(0));
      assert.deepEqual(respPayload2, sig2, 'Bridge 2 should receive beta signature');

      // Verify context strings reference correct remotes
      assert.ok(requests1[0].context.includes('repo-alpha'), 'Bridge 1 context should reference repo-alpha');
      assert.ok(requests2[0].context.includes('repo-beta'), 'Bridge 2 context should reference repo-beta');
    } finally {
      await bridge2.destroy();
    }
  });

  it('should reject non-whitelisted message types with FAILURE', async () => {
    const requests: BridgeRequest[] = [];

    bridge = await createBridge({
      sessionId: 'integ-session-4',
      socketPath,
      remoteContext: 'github.com:user/repo.git',
      onRequest: (req) => { requests.push(req); },
    });

    // Send ADD_IDENTITY (type 17) — not whitelisted
    const requestMsg = buildMessage(17, Buffer.from('fake-key-data'));
    const response = await sendAndReceive(socketPath, requestMsg);

    // Should NOT trigger onRequest
    assert.equal(requests.length, 0, 'Non-whitelisted type should not trigger onRequest');

    // Should return SSH_AGENT_FAILURE immediately
    const expected = Buffer.from([0, 0, 0, 1, SSH_AGENT_FAILURE]);
    assert.deepEqual(response, expected, 'Non-whitelisted type should return SSH_AGENT_FAILURE');
  });
});
