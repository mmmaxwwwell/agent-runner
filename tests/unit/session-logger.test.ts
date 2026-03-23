import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The module under test — will be implemented in T025
import {
  createSessionLogger,
  readLog,
  readLogFromOffset,
  type SessionLogEntry,
} from '../../src/services/session-logger.ts';

describe('session-logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSessionLogger', () => {
    it('should create a logger that writes to the specified file path', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'hello' });
      await logger.close();

      const raw = readFileSync(logPath, 'utf-8').trim();
      const entry = JSON.parse(raw) as SessionLogEntry;
      assert.equal(entry.stream, 'stdout');
      assert.equal(entry.content, 'hello');
    });

    it('should assign monotonically increasing sequence numbers', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'first' });
      await logger.write({ stream: 'stderr', content: 'second' });
      await logger.write({ stream: 'system', content: 'third' });
      await logger.close();

      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      assert.equal(lines.length, 3);

      const entries = lines.map(l => JSON.parse(l) as SessionLogEntry);
      assert.equal(entries[0].seq, 1);
      assert.equal(entries[1].seq, 2);
      assert.equal(entries[2].seq, 3);
    });

    it('should include a timestamp (ts) as a positive integer in each entry', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const before = Date.now();
      await logger.write({ stream: 'stdout', content: 'test' });
      const after = Date.now();
      await logger.close();

      const raw = readFileSync(logPath, 'utf-8').trim();
      const entry = JSON.parse(raw) as SessionLogEntry;

      assert.ok(Number.isInteger(entry.ts), 'ts should be an integer');
      assert.ok(entry.ts > 0, 'ts should be positive');
      assert.ok(entry.ts >= before && entry.ts <= after, 'ts should be within test window');
    });

    it('should write valid JSONL (one JSON object per line)', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'line one' });
      await logger.write({ stream: 'stderr', content: 'line two' });
      await logger.close();

      const raw = readFileSync(logPath, 'utf-8');
      const lines = raw.trim().split('\n');
      assert.equal(lines.length, 2);

      // Each line should be independently parseable JSON
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line), 'Each line should be valid JSON');
      }
    });

    it('should accept all three stream types: stdout, stderr, system', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'a' });
      await logger.write({ stream: 'stderr', content: 'b' });
      await logger.write({ stream: 'system', content: 'c' });
      await logger.close();

      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      const entries = lines.map(l => JSON.parse(l) as SessionLogEntry);

      assert.equal(entries[0].stream, 'stdout');
      assert.equal(entries[1].stream, 'stderr');
      assert.equal(entries[2].stream, 'system');
    });

    it('should handle empty content', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: '' });
      await logger.close();

      const raw = readFileSync(logPath, 'utf-8').trim();
      const entry = JSON.parse(raw) as SessionLogEntry;
      assert.equal(entry.content, '');
    });

    it('should handle content with special characters (newlines, quotes, unicode)', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'line1\nline2' });
      await logger.write({ stream: 'stdout', content: 'say "hello"' });
      await logger.write({ stream: 'stdout', content: 'emoji: 🎯' });
      await logger.close();

      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      const entries = lines.map(l => JSON.parse(l) as SessionLogEntry);

      assert.equal(entries[0].content, 'line1\nline2');
      assert.equal(entries[1].content, 'say "hello"');
      assert.equal(entries[2].content, 'emoji: 🎯');
    });

    it('should report the byte offset after each write', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const offset1 = await logger.write({ stream: 'stdout', content: 'first' });
      const offset2 = await logger.write({ stream: 'stdout', content: 'second' });
      await logger.close();

      // First entry starts at offset 0, so offset1 should be the end of the first line
      assert.ok(offset1 > 0, 'offset after first write should be positive');
      assert.ok(offset2 > offset1, 'offset after second write should be greater than first');

      // The total file size should match the last offset
      const fileContent = readFileSync(logPath);
      assert.equal(fileContent.length, offset2);
    });
  });

  describe('readLog', () => {
    it('should read all entries from a log file', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'one' });
      await logger.write({ stream: 'stderr', content: 'two' });
      await logger.write({ stream: 'system', content: 'three' });
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries.length, 3);
      assert.equal(entries[0].content, 'one');
      assert.equal(entries[1].content, 'two');
      assert.equal(entries[2].content, 'three');
    });

    it('should return entries with all required fields', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'test' });
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries.length, 1);

      const entry = entries[0];
      assert.ok('ts' in entry, 'entry should have ts');
      assert.ok('stream' in entry, 'entry should have stream');
      assert.ok('seq' in entry, 'entry should have seq');
      assert.ok('content' in entry, 'entry should have content');
    });

    it('should return empty array for empty file', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries.length, 0);
    });

    it('should preserve entry ordering', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      for (let i = 1; i <= 10; i++) {
        await logger.write({ stream: 'stdout', content: `entry-${i}` });
      }
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries.length, 10);

      for (let i = 0; i < 10; i++) {
        assert.equal(entries[i].seq, i + 1);
        assert.equal(entries[i].content, `entry-${i + 1}`);
      }
    });
  });

  describe('readLogFromOffset', () => {
    it('should read entries starting from a byte offset', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const offset1 = await logger.write({ stream: 'stdout', content: 'first' });
      await logger.write({ stream: 'stdout', content: 'second' });
      await logger.write({ stream: 'stdout', content: 'third' });
      await logger.close();

      // Read from after the first entry
      const entries = await readLogFromOffset(logPath, offset1);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].content, 'second');
      assert.equal(entries[1].content, 'third');
    });

    it('should return all entries when offset is 0', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'one' });
      await logger.write({ stream: 'stdout', content: 'two' });
      await logger.close();

      const entries = await readLogFromOffset(logPath, 0);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].content, 'one');
    });

    it('should return empty array when offset is at end of file', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const lastOffset = await logger.write({ stream: 'stdout', content: 'only entry' });
      await logger.close();

      const entries = await readLogFromOffset(logPath, lastOffset);
      assert.equal(entries.length, 0);
    });

    it('should correctly handle reading from offset after multiple writes', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'a' });
      const offset = await logger.write({ stream: 'stdout', content: 'b' });
      await logger.write({ stream: 'stdout', content: 'c' });
      await logger.write({ stream: 'stdout', content: 'd' });
      await logger.close();

      const entries = await readLogFromOffset(logPath, offset);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].content, 'c');
      assert.equal(entries[1].content, 'd');
    });
  });

  describe('sequence number monotonicity', () => {
    it('should produce strictly increasing sequence numbers across many writes', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      for (let i = 0; i < 50; i++) {
        await logger.write({ stream: 'stdout', content: `msg-${i}` });
      }
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries.length, 50);

      for (let i = 1; i < entries.length; i++) {
        assert.ok(
          entries[i].seq > entries[i - 1].seq,
          `seq ${entries[i].seq} should be greater than ${entries[i - 1].seq}`
        );
      }
    });

    it('should start sequence numbers at 1', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await logger.write({ stream: 'stdout', content: 'first' });
      await logger.close();

      const entries = await readLog(logPath);
      assert.equal(entries[0].seq, 1);
    });

    it('should have consecutive sequence numbers (no gaps)', async () => {
      const logPath = join(tmpDir, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      for (let i = 0; i < 10; i++) {
        await logger.write({ stream: 'stdout', content: `msg-${i}` });
      }
      await logger.close();

      const entries = await readLog(logPath);
      for (let i = 0; i < entries.length; i++) {
        assert.equal(entries[i].seq, i + 1, `Expected seq ${i + 1} but got ${entries[i].seq}`);
      }
    });
  });
});
