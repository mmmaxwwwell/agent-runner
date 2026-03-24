import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Module under test — will be implemented in T025
import { TranscriptParser } from '../../src/services/transcript-parser.ts';

/**
 * Helper: build a SessionLogEntry JSONL line.
 * Mirrors the format produced by src/services/session-logger.ts.
 */
function logEntry(seq: number, stream: 'stdout' | 'stderr' | 'system', content: string, ts?: number): string {
  return JSON.stringify({ ts: ts ?? Date.now(), stream, seq, content });
}

/**
 * Helper: build a Claude CLI stream-json assistant message event.
 * Claude CLI --output-format stream-json emits one JSON object per line on stdout.
 */
function assistantTextEvent(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function assistantToolUseEvent(toolName: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool_1', name: toolName, input }],
    },
  });
}

function assistantMixedEvent(text: string, toolName: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text },
        { type: 'tool_use', id: 'tool_2', name: toolName, input },
      ],
    },
  });
}

function userTextEvent(text: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

function resultEvent(): string {
  return JSON.stringify({ type: 'result', subtype: 'success', session_id: 'test-session' });
}

/** Wait for a condition or timeout */
async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

describe('TranscriptParser', () => {
  let tmpDir: string;
  let outputPath: string;
  let transcriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'transcript-parser-test-'));
    outputPath = join(tmpDir, 'output.jsonl');
    transcriptPath = join(tmpDir, 'transcript.md');
    // Create empty output file (parser expects it to exist or will create it)
    writeFileSync(outputPath, '', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parsing Claude CLI stream-json format', () => {
    it('should extract assistant text blocks as ## Agent sections', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Hello, I can help you with that.')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('## Agent'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('## Agent'), 'should contain ## Agent heading');
      assert.ok(transcript.includes('Hello, I can help you with that.'), 'should contain assistant text');
    });

    it('should extract user stdin as ## User sections', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', userTextEvent('Please help me set up my project')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('## User'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('## User'), 'should contain ## User heading');
      assert.ok(transcript.includes('Please help me set up my project'), 'should contain user text');
    });

    it('should handle a multi-turn conversation in order', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', userTextEvent('What is this project?')),
        logEntry(2, 'stdout', assistantTextEvent('This is a web server project.')),
        logEntry(3, 'stdout', userTextEvent('Can you add tests?')),
        logEntry(4, 'stdout', assistantTextEvent('Sure, I will add tests now.')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => {
        if (!existsSync(transcriptPath)) return false;
        const t = readFileSync(transcriptPath, 'utf-8');
        return t.includes('add tests now');
      });
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      // Verify ordering: User before Agent, then User again before Agent again
      const userIdx1 = transcript.indexOf('What is this project?');
      const agentIdx1 = transcript.indexOf('This is a web server project.');
      const userIdx2 = transcript.indexOf('Can you add tests?');
      const agentIdx2 = transcript.indexOf('add tests now');
      assert.ok(userIdx1 < agentIdx1, 'first user should come before first agent');
      assert.ok(agentIdx1 < userIdx2, 'first agent should come before second user');
      assert.ok(userIdx2 < agentIdx2, 'second user should come before second agent');
    });
  });

  describe('tool call handling', () => {
    it('should omit tool_use-only messages from transcript', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Let me check that file.')),
        logEntry(2, 'stdout', assistantToolUseEvent('Read', { file_path: '/src/index.ts' })),
        logEntry(3, 'stdout', assistantTextEvent('The file contains a server setup.')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => {
        if (!existsSync(transcriptPath)) return false;
        return readFileSync(transcriptPath, 'utf-8').includes('server setup');
      });
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('Let me check that file.'), 'text-only message should appear');
      assert.ok(transcript.includes('The file contains a server setup.'), 'second text message should appear');
      assert.ok(!transcript.includes('file_path'), 'tool_use input should not appear');
      assert.ok(!transcript.includes('/src/index.ts'), 'tool_use details should not appear');
    });

    it('should extract text from mixed text+tool_use messages', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantMixedEvent('I will read the config file.', 'Read', { file_path: '/config.ts' })),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('read the config'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('I will read the config file.'), 'text part should appear');
      assert.ok(!transcript.includes('/config.ts'), 'tool input should not appear');
    });
  });

  describe('incremental append', () => {
    it('should append new entries without overwriting existing content', async () => {
      // Write initial data
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', userTextEvent('First message')),
        logEntry(2, 'stdout', assistantTextEvent('First response')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('First response'));

      // Append more data to output.jsonl while parser is running
      appendFileSync(outputPath, [
        logEntry(3, 'stdout', userTextEvent('Second message')),
        logEntry(4, 'stdout', assistantTextEvent('Second response')),
      ].join('\n') + '\n');

      await waitFor(() => readFileSync(transcriptPath, 'utf-8').includes('Second response'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      // All four entries should be present
      assert.ok(transcript.includes('First message'), 'first user message should remain');
      assert.ok(transcript.includes('First response'), 'first agent response should remain');
      assert.ok(transcript.includes('Second message'), 'second user message should be appended');
      assert.ok(transcript.includes('Second response'), 'second agent response should be appended');
    });

    it('should not duplicate content when restarted on existing data', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Only once')),
      ].join('\n') + '\n');

      // First pass
      const parser1 = new TranscriptParser(outputPath, transcriptPath);
      parser1.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Only once'));
      parser1.stop();

      // Second pass (restart) — should not duplicate
      const parser2 = new TranscriptParser(outputPath, transcriptPath);
      parser2.start();
      // Give it time to process (it should detect nothing new)
      await new Promise(r => setTimeout(r, 200));
      parser2.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      const occurrences = transcript.split('Only once').length - 1;
      assert.equal(occurrences, 1, 'text should appear exactly once, not duplicated on restart');
    });
  });

  describe('malformed JSON handling', () => {
    it('should skip malformed JSON lines in output.jsonl', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Before bad line')),
        'this is not valid json at all',
        logEntry(3, 'stdout', assistantTextEvent('After bad line')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('After bad line'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('Before bad line'), 'line before malformed should appear');
      assert.ok(transcript.includes('After bad line'), 'line after malformed should appear');
    });

    it('should skip entries where content is not valid Claude CLI JSON', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', 'not a json event, just raw text'),
        logEntry(2, 'stdout', assistantTextEvent('Valid message')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Valid message'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('Valid message'), 'valid entry should appear');
      assert.ok(!transcript.includes('not a json event'), 'raw text content should not appear');
    });

    it('should skip stderr and system entries', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stderr', 'some error output'),
        logEntry(2, 'system', 'system message'),
        logEntry(3, 'stdout', assistantTextEvent('Real output')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Real output'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(!transcript.includes('some error output'), 'stderr should not appear');
      assert.ok(!transcript.includes('system message'), 'system entries should not appear');
      assert.ok(transcript.includes('Real output'), 'stdout assistant text should appear');
    });
  });

  describe('non-message event types', () => {
    it('should skip result events', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Before result')),
        logEntry(2, 'stdout', resultEvent()),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Before result'));
      // Give it time to process the result event too
      await new Promise(r => setTimeout(r, 150));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('Before result'), 'assistant text should appear');
      assert.ok(!transcript.includes('success'), 'result event content should not appear');
    });
  });

  describe('start/stop lifecycle', () => {
    it('should not write to transcript before start() is called', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Should not appear yet')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      // Do NOT call start()
      await new Promise(r => setTimeout(r, 200));

      assert.ok(!existsSync(transcriptPath) || readFileSync(transcriptPath, 'utf-8').length === 0,
        'transcript should not be written before start()');
      parser.stop(); // Should be safe to call stop even if never started
    });

    it('should stop polling after stop() is called', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('Initial')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Initial'));
      parser.stop();

      // Append more data after stop
      appendFileSync(outputPath, logEntry(2, 'stdout', assistantTextEvent('After stop')) + '\n');
      await new Promise(r => setTimeout(r, 200));

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(!transcript.includes('After stop'), 'data appended after stop() should not be processed');
    });
  });

  describe('empty and edge cases', () => {
    it('should handle empty output.jsonl', async () => {
      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await new Promise(r => setTimeout(r, 200));
      parser.stop();

      // Should not crash; transcript may not exist or be empty
      assert.ok(!existsSync(transcriptPath) || readFileSync(transcriptPath, 'utf-8').length === 0,
        'transcript should be empty or absent for empty input');
    });

    it('should handle assistant messages with empty text', async () => {
      writeFileSync(outputPath, [
        logEntry(1, 'stdout', assistantTextEvent('')),
        logEntry(2, 'stdout', assistantTextEvent('Non-empty message')),
      ].join('\n') + '\n');

      const parser = new TranscriptParser(outputPath, transcriptPath);
      parser.start();
      await waitFor(() => existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf-8').includes('Non-empty'));
      parser.stop();

      const transcript = readFileSync(transcriptPath, 'utf-8');
      assert.ok(transcript.includes('Non-empty message'), 'non-empty messages should appear');
    });
  });
});
