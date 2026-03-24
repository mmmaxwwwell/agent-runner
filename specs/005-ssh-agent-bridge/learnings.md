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

### T005 — Stub exports needed for shared test file
- The test file `tests/unit/ssh-agent-protocol.test.ts` imports `readSSHString`, `parseMessage`, and `MessageAccumulator` in one import statement. Because the test runner loads the entire file before filtering by `--test-name-pattern`, ALL three exports must exist for ANY test suite to run.
- Added throwing stubs for `parseMessage` and `MessageAccumulator` so T005 tests pass. T006/T007 will replace these stubs with real implementations.
- `readSSHString` uses `Buffer.from(data)` to copy the subarray — avoids returning a view into the original buffer that could be mutated.

