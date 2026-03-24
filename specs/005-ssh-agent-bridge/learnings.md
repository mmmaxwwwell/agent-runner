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

### T014 — Env var plumbing for SandboxCommand and spawnProcess
- `SandboxCommand.env` is an optional `Record<string, string>` that callers populate after `buildCommand()`.
- `spawnProcess()` merges `env` into `process.env` via `spawn()` options. When `env` is undefined, `spawn()` inherits the parent env by default.
- `TaskLoopOptions` also has `env` which is passed through to each `spawnProcess()` call in the loop.
- **Important for T015/T016**: When sandboxed (`systemd-run`), env vars set via `spawn({ env })` only affect `systemd-run` itself, NOT the sandboxed child. For sandboxed processes, `SSH_AUTH_SOCK` must also be injected as `--setenv=SSH_AUTH_SOCK=<path>` in the args array. Additionally, the socket path must be added to `BindPaths` so the sandboxed process can access it.
- Pre-existing build errors in `ssh-agent-bridge.ts` (TS5097 import extension, TS2345 Buffer type) — not related to T014.

### T015 — Wiring bridge into session routes
- Bridge lifecycle: created after `createSession()` (session dir must exist), destroyed on session end (completed/failed/stopped). Preserved during `waiting-for-input` so it persists across task loop respawns.
- `getActiveBridge(sessionId)` is exported from `sessions.ts` for T025 (WebSocket message handlers) to look up bridges.
- `injectSSHAuthSock` handles both sandboxed and unsandboxed: sets `env.SSH_AUTH_SOCK`, and for sandboxed also splices `--setenv=SSH_AUTH_SOCK=<path>` before the `nix` arg and appends socket path to `--property=BindPaths=`.
- The input resume route (`POST /api/sessions/:id/input`) reuses the existing bridge if still alive, or creates a new one. This matters because the bridge socket server is independent of the child process.
- Fixed pre-existing build errors in `ssh-agent-bridge.ts`: import extension `.ts` → `.js` (TS5097), and added explicit `Buffer` type annotation on socket data handler (TS2345).

### T016 — Wiring bridge into projects.ts workflow phases
- `setupBridge`, `cleanupBridge`, and `injectSSHAuthSock` are now exported from `sessions.ts` for reuse. Both `runPhase` callbacks in `projects.ts` (add-feature and start-planning) follow the same pattern as the session routes.
- Each workflow phase gets its own bridge (tied to the phase's `sessionId`), created before spawn and cleaned up after `waitForExit()`. This means the bridge is ephemeral per-phase, not per-workflow.
- The shared `activeBridges` map in `sessions.ts` means WebSocket handlers can find bridges regardless of whether they were created by session routes or project workflow routes.

### T013 — Bridge implementation patterns
- `createBridge` uses closure-based state (pendingRequests map, server) rather than a class — keeps the public interface minimal (just the SSHAgentBridge interface methods).
- Stale socket removal uses `unlink` with ENOENT suppression before `server.listen()`.
- The `FAILURE_RESPONSE` constant (`Buffer.from([0, 0, 0, 1, 5])`) is shared across timeout, cancel, destroy, and non-whitelisted message handling.
- Context string format for sign requests: `"Sign request for git push to <remote> (user: <user>, algo: <algo>)"`. For list keys: `"List SSH keys for <remote>"`.
- `handleResponse` wraps the data with a 4-byte big-endian length prefix before writing to the Unix socket.

