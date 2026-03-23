import { createWriteStream, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { WriteStream } from 'node:fs';

export interface SessionLogEntry {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  seq: number;
  content: string;
}

export interface WriteInput {
  stream: 'stdout' | 'stderr' | 'system';
  content: string;
}

export interface SessionLogger {
  /** Write an entry, returns byte offset after this write */
  write(input: WriteInput): Promise<number>;
  /** Close the underlying stream */
  close(): Promise<void>;
}

export function createSessionLogger(logPath: string): SessionLogger {
  const ws: WriteStream = createWriteStream(logPath, { flags: 'a' });
  let seq = 0;
  let byteOffset = 0;

  return {
    write(input: WriteInput): Promise<number> {
      seq++;
      const entry: SessionLogEntry = {
        ts: Date.now(),
        stream: input.stream,
        seq,
        content: input.content,
      };
      const line = JSON.stringify(entry) + '\n';
      const lineBytes = Buffer.byteLength(line, 'utf-8');

      return new Promise<number>((resolve, reject) => {
        ws.write(line, 'utf-8', (err) => {
          if (err) {
            reject(err);
            return;
          }
          byteOffset += lineBytes;
          resolve(byteOffset);
        });
      });
    },

    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        ws.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

export async function readLog(logPath: string): Promise<SessionLogEntry[]> {
  return readLogFromOffset(logPath, 0);
}

export async function readLogFromOffset(logPath: string, byteOffset: number): Promise<SessionLogEntry[]> {
  const entries: SessionLogEntry[] = [];

  return new Promise<SessionLogEntry[]>((resolve, reject) => {
    const stream = createReadStream(logPath, { start: byteOffset, encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      try {
        entries.push(JSON.parse(trimmed) as SessionLogEntry);
      } catch {
        // Skip malformed lines
      }
    });

    rl.on('close', () => resolve(entries));
    rl.on('error', reject);
    stream.on('error', reject);
  });
}
