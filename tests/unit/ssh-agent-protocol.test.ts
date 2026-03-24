import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readSSHString, parseMessage, MessageAccumulator } from '../../src/services/ssh-agent-protocol.ts';

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
