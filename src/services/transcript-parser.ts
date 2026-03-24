/**
 * Transcript parser — converts output.jsonl (Claude CLI stream-json) to transcript.md
 *
 * Polls output.jsonl for new entries, parses Claude CLI stream-json events,
 * extracts assistant text → ## Agent, user input → ## User, omits tool_use blocks.
 * Appends incrementally to transcript.md.
 */

import { statSync, openSync, readSync, closeSync, appendFileSync, existsSync } from 'node:fs';

const POLL_INTERVAL = 80; // ms

interface SessionLogEntry {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  seq: number;
  content: string;
}

interface CliEvent {
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
}

export class TranscriptParser {
  private outputPath: string;
  private transcriptPath: string;
  private byteOffset: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reading = false;

  constructor(outputJsonlPath: string, transcriptPath: string) {
    this.outputPath = outputJsonlPath;
    this.transcriptPath = transcriptPath;
    // If transcript already exists, set byteOffset to current output file size
    // to avoid re-processing lines that produced the existing transcript
    this.byteOffset = 0;
    if (existsSync(transcriptPath)) {
      try {
        const transcriptSize = statSync(transcriptPath).size;
        if (transcriptSize > 0) {
          // Existing transcript — assume output.jsonl was already processed up to current size
          try {
            this.byteOffset = statSync(outputJsonlPath).size;
          } catch {
            // output file doesn't exist yet, start from 0
          }
        }
      } catch {
        // transcript doesn't exist or can't stat — start from 0
      }
    }
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
    // Do an immediate poll
    this.poll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private poll(): void {
    if (this.reading) return;
    this.reading = true;
    try {
      let fileSize: number;
      try {
        fileSize = statSync(this.outputPath).size;
      } catch {
        return;
      }
      if (fileSize <= this.byteOffset) return;

      const bytesToRead = fileSize - this.byteOffset;
      const buf = Buffer.alloc(bytesToRead);
      const fd = openSync(this.outputPath, 'r');
      try {
        readSync(fd, buf, 0, bytesToRead, this.byteOffset);
      } finally {
        closeSync(fd);
      }
      this.byteOffset = fileSize;

      const text = buf.toString('utf-8');
      const lines = text.split('\n');
      let output = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        let entry: SessionLogEntry;
        try {
          entry = JSON.parse(trimmed);
        } catch {
          continue; // skip malformed outer JSON
        }

        if (entry.stream !== 'stdout') continue;

        let event: CliEvent;
        try {
          event = JSON.parse(entry.content);
        } catch {
          continue; // skip non-JSON content
        }

        if (event.type !== 'assistant' && event.type !== 'user') continue;
        if (!event.message?.content) continue;

        // Extract text blocks only (skip tool_use)
        const textParts: string[] = [];
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }

        if (textParts.length === 0) continue;

        const heading = event.message.role === 'assistant' ? '## Agent' : '## User';
        output += `${heading}\n\n${textParts.join('\n\n')}\n\n`;
      }

      if (output.length > 0) {
        appendFileSync(this.transcriptPath, output, 'utf-8');
      }
    } catch {
      // Silently handle errors to avoid crashing the poll loop
    } finally {
      this.reading = false;
    }
  }
}
