/**
 * Transcript parser — converts output.jsonl (Claude CLI stream-json) to transcript.md
 *
 * Polls output.jsonl for new entries, parses Claude CLI stream-json events,
 * extracts assistant text → ## Agent, user input → ## User, omits tool_use blocks.
 * Appends incrementally to transcript.md.
 *
 * Stub — implementation in T025.
 */

export class TranscriptParser {
  constructor(_outputJsonlPath: string, _transcriptPath: string) {
    // Stub — T025 implements
  }

  start(): void {
    throw new Error('TranscriptParser.start() not implemented — see T025');
  }

  stop(): void {
    // Safe to call even if not started
  }
}
