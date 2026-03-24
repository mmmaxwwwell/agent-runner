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
 */
export function parseMessage(buf: Buffer): { type: number; payload: Buffer; totalLength: number } | null {
  if (buf.length < 4) return null;
  const length = buf.readUInt32BE(0);
  if (length === 0) return null;
  if (buf.length < 4 + length) return null;
  const type = buf[4];
  const payload = Buffer.from(buf.subarray(5, 4 + length));
  return { type, payload, totalLength: 4 + length };
}

/**
 * Parse a SIGN_REQUEST (type 13) payload into its components.
 * Payload format: string key_blob, string data, uint32 flags.
 * Attempts to extract username and key algorithm from the data field
 * if it is in SSH userauth format.
 * Returns null if the payload is too short to parse.
 */
export function parseSignRequest(payload: Buffer): {
  keyBlob: Buffer;
  data: Buffer;
  flags: number;
  username?: string;
  keyAlgorithm?: string;
} | null {
  throw new Error('parseSignRequest not yet implemented');
}

/**
 * Buffers incoming data and emits complete SSH agent messages.
 * Handles partial reads across multiple feed() calls.
 */
export class MessageAccumulator {
  private buffer: Buffer = Buffer.alloc(0);
  private callback: ((type: number, payload: Buffer) => void) | null = null;

  onMessage(callback: (type: number, payload: Buffer) => void): void {
    this.callback = callback;
  }

  feed(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (true) {
      const msg = parseMessage(this.buffer);
      if (!msg) break;
      this.buffer = this.buffer.subarray(msg.totalLength);
      if (this.callback) {
        this.callback(msg.type, msg.payload);
      }
    }
  }
}
