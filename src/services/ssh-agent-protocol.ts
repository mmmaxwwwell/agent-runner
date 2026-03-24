// SSH Agent Protocol message types
// Reference: https://datatracker.ietf.org/doc/html/draft-miller-ssh-agent

export const SSH_AGENT_FAILURE = 5;
export const SSH_AGENT_SUCCESS = 6;
export const SSH_AGENTC_REQUEST_IDENTITIES = 11;
export const SSH_AGENT_IDENTITIES_ANSWER = 12;
export const SSH_AGENTC_SIGN_REQUEST = 13;
export const SSH_AGENT_SIGN_RESPONSE = 14;

/**
 * Read an SSH string (4-byte big-endian length prefix + data) from a buffer at the given offset.
 * Returns null if the buffer doesn't contain enough data.
 */
export function readSSHString(buf: Buffer, offset: number): { data: Buffer; bytesRead: number } | null {
  if (buf.length - offset < 4) return null;
  const length = buf.readUInt32BE(offset);
  if (buf.length - offset < 4 + length) return null;
  const data = buf.subarray(offset + 4, offset + 4 + length);
  return { data: Buffer.from(data), bytesRead: 4 + length };
}

/**
 * Parse a single SSH agent message from a buffer.
 * Wire format: [4-byte big-endian length] [1-byte type] [payload...]
 * Returns null if the buffer doesn't contain a complete message.
 * Stub — full implementation in T006.
 */
export function parseMessage(_buf: Buffer): { type: number; payload: Buffer; totalLength: number } | null {
  throw new Error('parseMessage not yet implemented');
}

/**
 * Buffers incoming data and emits complete SSH agent messages.
 * Stub — full implementation in T007.
 */
export class MessageAccumulator {
  onMessage(_callback: (type: number, payload: Buffer) => void): void {
    throw new Error('MessageAccumulator not yet implemented');
  }
  feed(_chunk: Buffer): void {
    throw new Error('MessageAccumulator not yet implemented');
  }
}
