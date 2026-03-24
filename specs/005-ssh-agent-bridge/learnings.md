# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T002 — SSH string reader test pattern
- `readSSHString(buf, offset)` returns `{ data: Buffer, bytesRead: number } | null`. Returns null when buffer is too short (either for the 4-byte length header or the declared data length).
- Tests live in `tests/unit/ssh-agent-protocol.test.ts` — T003 and T004 tests should be added to the same file.
- Project uses `node:test` (describe/it) + `node:assert/strict`. No external test framework.

### T004 — MessageAccumulator test expectations
- Expected API: `new MessageAccumulator()`, `.onMessage((type, payload) => ...)`, `.feed(chunk: Buffer)`.
- The `onMessage` callback receives `(type: number, payload: Buffer)` — type and payload already parsed.
- Tests cover: single chunk, multi-part partial feeds, multiple messages in one chunk, buffer reset between messages, and cross-message split with leftover bytes.

