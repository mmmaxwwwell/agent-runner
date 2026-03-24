import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readSSHString, parseMessage, MessageAccumulator, parseSignRequest } from '../../src/services/ssh-agent-protocol.ts';

describe('readSSHString', () => {
  it('should read a string with 4-byte big-endian length prefix', () => {
    const data = Buffer.from('hello');
    const buf = Buffer.alloc(4 + data.length);
    buf.writeUInt32BE(data.length, 0);
    data.copy(buf, 4);

    const result = readSSHString(buf, 0);
    assert.deepEqual(result.data, data);
    assert.equal(result.bytesRead, 4 + data.length);
  });

  it('should read a string at a non-zero offset', () => {
    const prefix = Buffer.from([0xaa, 0xbb]); // 2 bytes of junk before
    const data = Buffer.from('world');
    const buf = Buffer.alloc(prefix.length + 4 + data.length);
    prefix.copy(buf, 0);
    buf.writeUInt32BE(data.length, prefix.length);
    data.copy(buf, prefix.length + 4);

    const result = readSSHString(buf, prefix.length);
    assert.deepEqual(result.data, data);
    assert.equal(result.bytesRead, 4 + data.length);
  });

  it('should return null for partial buffer — length header truncated', () => {
    const buf = Buffer.from([0x00, 0x00]); // only 2 bytes, need 4
    const result = readSSHString(buf, 0);
    assert.equal(result, null);
  });

  it('should return null for partial buffer — data shorter than declared length', () => {
    const buf = Buffer.alloc(4 + 2);
    buf.writeUInt32BE(10, 0); // declares 10 bytes but only 2 available
    buf[4] = 0x41;
    buf[5] = 0x42;

    const result = readSSHString(buf, 0);
    assert.equal(result, null);
  });

  it('should read multiple strings in sequence', () => {
    const s1 = Buffer.from('abc');
    const s2 = Buffer.from('defgh');
    const buf = Buffer.alloc(4 + s1.length + 4 + s2.length);
    let offset = 0;
    buf.writeUInt32BE(s1.length, offset); offset += 4;
    s1.copy(buf, offset); offset += s1.length;
    buf.writeUInt32BE(s2.length, offset); offset += 4;
    s2.copy(buf, offset);

    const r1 = readSSHString(buf, 0);
    assert.ok(r1);
    assert.deepEqual(r1.data, s1);

    const r2 = readSSHString(buf, r1.bytesRead);
    assert.ok(r2);
    assert.deepEqual(r2.data, s2);
    assert.equal(r2.bytesRead, 4 + s2.length);
  });

  it('should handle empty string (length = 0)', () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(0, 0);

    const result = readSSHString(buf, 0);
    assert.ok(result);
    assert.equal(result.data.length, 0);
    assert.equal(result.bytesRead, 4);
  });
});

describe('parseMessage', () => {
  // SSH agent wire format: [4-byte big-endian length] [1-byte type] [payload...]
  // length = 1 (type byte) + payload.length

  function buildMessage(type: number, payload: Buffer): Buffer {
    const length = 1 + payload.length;
    const buf = Buffer.alloc(4 + length);
    buf.writeUInt32BE(length, 0);
    buf[4] = type;
    payload.copy(buf, 5);
    return buf;
  }

  it('should extract a complete message from a buffer', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const buf = buildMessage(13, payload);

    const result = parseMessage(buf);
    assert.ok(result);
    assert.equal(result.type, 13);
    assert.deepEqual(result.payload, payload);
    assert.equal(result.totalLength, 4 + 1 + payload.length);
  });

  it('should return null for partial buffer — length header truncated', () => {
    const buf = Buffer.from([0x00, 0x00]); // only 2 bytes, need at least 4
    const result = parseMessage(buf);
    assert.equal(result, null);
  });

  it('should return null for partial buffer — body shorter than declared length', () => {
    const buf = Buffer.alloc(4 + 2);
    buf.writeUInt32BE(10, 0); // declares 10 bytes but only 2 available after header
    buf[4] = 11;
    buf[5] = 0xff;

    const result = parseMessage(buf);
    assert.equal(result, null);
  });

  it('should extract multiple messages from one buffer', () => {
    const p1 = Buffer.from([0xaa]);
    const p2 = Buffer.from([0xbb, 0xcc]);
    const msg1 = buildMessage(11, p1);
    const msg2 = buildMessage(13, p2);
    const buf = Buffer.concat([msg1, msg2]);

    const r1 = parseMessage(buf);
    assert.ok(r1);
    assert.equal(r1.type, 11);
    assert.deepEqual(r1.payload, p1);

    const r2 = parseMessage(buf.subarray(r1.totalLength));
    assert.ok(r2);
    assert.equal(r2.type, 13);
    assert.deepEqual(r2.payload, p2);
  });

  it('should handle zero-length payload (length field = 1, type only)', () => {
    const buf = Buffer.alloc(5);
    buf.writeUInt32BE(1, 0); // length = 1 (just the type byte)
    buf[4] = 5; // SSH_AGENT_FAILURE

    const result = parseMessage(buf);
    assert.ok(result);
    assert.equal(result.type, 5);
    assert.equal(result.payload.length, 0);
    assert.equal(result.totalLength, 5);
  });

  it('should return null for zero-length message (length field = 0)', () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(0, 0); // length = 0, no type byte

    const result = parseMessage(buf);
    assert.equal(result, null);
  });
});

describe('MessageAccumulator', () => {
  function buildMessage(type: number, payload: Buffer): Buffer {
    const length = 1 + payload.length;
    const buf = Buffer.alloc(4 + length);
    buf.writeUInt32BE(length, 0);
    buf[4] = type;
    payload.copy(buf, 5);
    return buf;
  }

  it('should emit a complete message fed in one chunk', () => {
    const acc = new MessageAccumulator();
    const received: Array<{ type: number; payload: Buffer }> = [];
    acc.onMessage((type, payload) => received.push({ type, payload }));

    const payload = Buffer.from([0x01, 0x02]);
    acc.feed(buildMessage(13, payload));

    assert.equal(received.length, 1);
    assert.equal(received[0].type, 13);
    assert.deepEqual(received[0].payload, payload);
  });

  it('should accumulate partial data across multiple feed calls', () => {
    const acc = new MessageAccumulator();
    const received: Array<{ type: number; payload: Buffer }> = [];
    acc.onMessage((type, payload) => received.push({ type, payload }));

    const msg = buildMessage(11, Buffer.from([0xaa, 0xbb, 0xcc]));

    // Feed the message in three parts
    acc.feed(msg.subarray(0, 2));  // partial length header
    assert.equal(received.length, 0);

    acc.feed(msg.subarray(2, 6));  // rest of header + partial body
    assert.equal(received.length, 0);

    acc.feed(msg.subarray(6));     // remaining body
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 11);
    assert.deepEqual(received[0].payload, Buffer.from([0xaa, 0xbb, 0xcc]));
  });

  it('should emit multiple messages from one chunk', () => {
    const acc = new MessageAccumulator();
    const received: Array<{ type: number; payload: Buffer }> = [];
    acc.onMessage((type, payload) => received.push({ type, payload }));

    const msg1 = buildMessage(11, Buffer.from([0x01]));
    const msg2 = buildMessage(13, Buffer.from([0x02, 0x03]));
    const combined = Buffer.concat([msg1, msg2]);

    acc.feed(combined);

    assert.equal(received.length, 2);
    assert.equal(received[0].type, 11);
    assert.deepEqual(received[0].payload, Buffer.from([0x01]));
    assert.equal(received[1].type, 13);
    assert.deepEqual(received[1].payload, Buffer.from([0x02, 0x03]));
  });

  it('should reset internal buffer after extracting a message', () => {
    const acc = new MessageAccumulator();
    const received: Array<{ type: number; payload: Buffer }> = [];
    acc.onMessage((type, payload) => received.push({ type, payload }));

    // Feed first complete message
    acc.feed(buildMessage(11, Buffer.from([0x01])));
    assert.equal(received.length, 1);

    // Feed second complete message — should work independently
    acc.feed(buildMessage(13, Buffer.from([0x02])));
    assert.equal(received.length, 2);
    assert.equal(received[1].type, 13);
    assert.deepEqual(received[1].payload, Buffer.from([0x02]));
  });

  it('should handle a message split between two chunks with leftover', () => {
    const acc = new MessageAccumulator();
    const received: Array<{ type: number; payload: Buffer }> = [];
    acc.onMessage((type, payload) => received.push({ type, payload }));

    const msg1 = buildMessage(11, Buffer.from([0x01]));
    const msg2 = buildMessage(5, Buffer.alloc(0));

    // Send msg1 + partial msg2 in one chunk
    const combined = Buffer.concat([msg1, msg2]);
    const split = 8; // somewhere in msg2
    acc.feed(combined.subarray(0, split));
    assert.equal(received.length, 1); // msg1 emitted

    // Send the rest
    acc.feed(combined.subarray(split));
    assert.equal(received.length, 2); // msg2 emitted
    assert.equal(received[1].type, 5);
  });
});

describe('parseSignRequest', () => {
  // Helper: write an SSH string (4-byte BE length + data) into a buffer at offset
  function writeSSHString(buf: Buffer, offset: number, data: Buffer): number {
    buf.writeUInt32BE(data.length, offset);
    data.copy(buf, offset + 4);
    return 4 + data.length;
  }

  // Build a sign request payload: string key_blob, string data, uint32 flags
  function buildSignRequestPayload(keyBlob: Buffer, data: Buffer, flags: number): Buffer {
    const buf = Buffer.alloc(4 + keyBlob.length + 4 + data.length + 4);
    let offset = 0;
    offset += writeSSHString(buf, offset, keyBlob);
    offset += writeSSHString(buf, offset, data);
    buf.writeUInt32BE(flags, offset);
    return buf;
  }

  // Build an SSH userauth data field:
  // string session_id, byte 50, string username, string service, string "publickey",
  // boolean TRUE, string algorithm, string key_blob
  function buildUserauthData(opts: {
    sessionId: Buffer;
    username: string;
    service: string;
    algorithm: string;
    keyBlob: Buffer;
  }): Buffer {
    const usernameBuf = Buffer.from(opts.username);
    const serviceBuf = Buffer.from(opts.service);
    const methodBuf = Buffer.from('publickey');
    const algoBuf = Buffer.from(opts.algorithm);

    const totalLen =
      4 + opts.sessionId.length +   // session_id
      1 +                             // byte 50
      4 + usernameBuf.length +        // username
      4 + serviceBuf.length +         // service
      4 + methodBuf.length +          // "publickey"
      1 +                             // boolean TRUE
      4 + algoBuf.length +            // algorithm
      4 + opts.keyBlob.length;        // key_blob

    const buf = Buffer.alloc(totalLen);
    let offset = 0;
    offset += writeSSHString(buf, offset, opts.sessionId);
    buf[offset] = 50; offset += 1; // SSH_MSG_USERAUTH_REQUEST
    offset += writeSSHString(buf, offset, usernameBuf);
    offset += writeSSHString(buf, offset, serviceBuf);
    offset += writeSSHString(buf, offset, methodBuf);
    buf[offset] = 1; offset += 1; // boolean TRUE
    offset += writeSSHString(buf, offset, algoBuf);
    writeSSHString(buf, offset, opts.keyBlob);

    return buf;
  }

  it('should extract key blob, data, and flags from a sign request payload', () => {
    const keyBlob = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const data = Buffer.from([0xaa, 0xbb, 0xcc]);
    const flags = 2; // SSH_AGENT_RSA_SHA2_256

    const payload = buildSignRequestPayload(keyBlob, data, flags);
    const result = parseSignRequest(payload);

    assert.ok(result);
    assert.deepEqual(result.keyBlob, keyBlob);
    assert.deepEqual(result.data, data);
    assert.equal(result.flags, flags);
  });

  it('should extract username and key algorithm from SSH userauth data', () => {
    const keyBlob = Buffer.from([0x01, 0x02, 0x03]);
    const sessionId = Buffer.from('fake-session-hash-value');
    const userauthData = buildUserauthData({
      sessionId,
      username: 'git',
      service: 'ssh-connection',
      algorithm: 'ecdsa-sha2-nistp256',
      keyBlob,
    });
    const flags = 0;

    const payload = buildSignRequestPayload(keyBlob, userauthData, flags);
    const result = parseSignRequest(payload);

    assert.ok(result);
    assert.equal(result.username, 'git');
    assert.equal(result.keyAlgorithm, 'ecdsa-sha2-nistp256');
    assert.deepEqual(result.keyBlob, keyBlob);
    assert.deepEqual(result.data, userauthData);
    assert.equal(result.flags, 0);
  });

  it('should return undefined username/keyAlgorithm when data is not SSH userauth format', () => {
    const keyBlob = Buffer.from([0x05, 0x06]);
    const data = Buffer.from('this is not userauth data');
    const flags = 4;

    const payload = buildSignRequestPayload(keyBlob, data, flags);
    const result = parseSignRequest(payload);

    assert.ok(result);
    assert.deepEqual(result.keyBlob, keyBlob);
    assert.deepEqual(result.data, data);
    assert.equal(result.flags, flags);
    assert.equal(result.username, undefined);
    assert.equal(result.keyAlgorithm, undefined);
  });

  it('should return undefined username/keyAlgorithm when data byte 50 marker is missing', () => {
    // Build a buffer that looks like it could be userauth but has wrong type byte
    const keyBlob = Buffer.from([0x01]);
    const sessionId = Buffer.from('session');
    const buf = Buffer.alloc(4 + sessionId.length + 1);
    buf.writeUInt32BE(sessionId.length, 0);
    sessionId.copy(buf, 4);
    buf[4 + sessionId.length] = 99; // wrong type byte, not 50

    const payload = buildSignRequestPayload(keyBlob, buf, 0);
    const result = parseSignRequest(payload);

    assert.ok(result);
    assert.equal(result.username, undefined);
    assert.equal(result.keyAlgorithm, undefined);
  });

  it('should handle truncated userauth data gracefully', () => {
    const keyBlob = Buffer.from([0x01]);
    // Build a buffer that starts like userauth (session_id + byte 50) but is truncated
    const sessionId = Buffer.from('sess');
    const buf = Buffer.alloc(4 + sessionId.length + 1);
    buf.writeUInt32BE(sessionId.length, 0);
    sessionId.copy(buf, 4);
    buf[4 + sessionId.length] = 50; // correct type byte, but no username follows

    const payload = buildSignRequestPayload(keyBlob, buf, 0);
    const result = parseSignRequest(payload);

    assert.ok(result);
    assert.deepEqual(result.keyBlob, keyBlob);
    assert.equal(result.flags, 0);
    assert.equal(result.username, undefined);
    assert.equal(result.keyAlgorithm, undefined);
  });

  it('should return null for truncated payload — missing data field', () => {
    // Only key blob, no data or flags
    const keyBlob = Buffer.from([0x01, 0x02]);
    const buf = Buffer.alloc(4 + keyBlob.length);
    buf.writeUInt32BE(keyBlob.length, 0);
    keyBlob.copy(buf, 4);

    const result = parseSignRequest(buf);
    assert.equal(result, null);
  });

  it('should return null for empty payload', () => {
    const result = parseSignRequest(Buffer.alloc(0));
    assert.equal(result, null);
  });
});
