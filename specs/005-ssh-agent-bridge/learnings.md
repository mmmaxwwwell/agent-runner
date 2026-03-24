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

### T008 — Bridge lifecycle test patterns and stub approach
- `createBridge()` is async (returns `Promise<SSHAgentBridge>`) — the socket server needs to be listening before tests proceed.
- Tests use `mkdtemp` for isolated tmp dirs. Socket path is passed directly (not derived from dataDir/sessionId) to keep tests simple.
- Added `timeoutMs` option to `CreateBridgeOptions` so tests can use a short timeout (100ms) instead of waiting 60s.
- Stub module at `src/services/ssh-agent-bridge.ts` exports types + a throwing `createBridge` — same pattern as T005's stubs. T013 will replace with real implementation.
- `BridgeRequest` interface defined in stub: `{ requestId, messageType, context, data }` — tests for `onRequest` callback use this shape.

### T009 — Sign request parsing test expectations
- `parseSignRequest(payload)` returns `{ keyBlob: Buffer, data: Buffer, flags: number, username?: string, keyAlgorithm?: string } | null`. Returns null for truncated/empty payloads.
- SSH userauth data format: `string session_id`, `byte 50` (SSH_MSG_USERAUTH_REQUEST), `string username`, `string service`, `string "publickey"`, `boolean TRUE`, `string algorithm`, `string key_blob`.
- The byte 50 marker after session_id is the key indicator for userauth format. If missing or data is too short, username/keyAlgorithm should be undefined (not null, not error).
- Stub added to `ssh-agent-protocol.ts` following same pattern as T005 — throws "not yet implemented". T011 will replace with real implementation.

### T010 — Integration test patterns for bridge end-to-end
- Integration tests use real Unix sockets (not mocks). Connect with `net.createConnection`, send wire-format messages, read response.
- The `onRequest` callback in tests simulates the WebSocket client by immediately calling `bridge.handleResponse()` or `bridge.handleCancel()`.
- `sendAndReceive()` helper resolves on first `data` event since the bridge writes complete messages atomically. `sendToSocket()` waits for `end` event for cases where the server closes the connection.
- Tests cover: REQUEST_IDENTITIES round-trip, SIGN_REQUEST round-trip, cancel → FAILURE, non-whitelisted type → FAILURE without onRequest.
- The `handleResponse` data parameter includes the type byte + payload (the full message body excluding the 4-byte length prefix). T013 must wrap it with the length prefix before writing to the socket.

