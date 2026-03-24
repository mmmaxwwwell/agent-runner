# Tasks: SSH Agent WebSocket Bridge

**Input**: Design documents from `/specs/005-ssh-agent-bridge/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included per constitution requirement (VII. Test-First).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new dependencies needed — uses Node.js built-in `net` module. Setup is minimal.

- [x] T001 Add SSH agent protocol constants (message types 5, 6, 11, 12, 13, 14) to src/services/ssh-agent-protocol.ts — export as named constants

**Checkpoint**: Constants available for all subsequent work

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Binary protocol parser and message accumulation — all user stories depend on these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational Phase

- [x] T002 [P] Write tests for SSH string reader utility in tests/unit/ssh-agent-protocol.test.ts — test reading 4-byte big-endian length + data from Buffer, test partial buffer handling, test multiple strings in sequence, test empty string
- [x] T003 [P] Write tests for message framing in tests/unit/ssh-agent-protocol.test.ts — test extracting complete message from Buffer (4-byte length + type + payload), test partial message returns null, test multiple messages in one buffer, test zero-length edge case
- [x] T004 [P] Write tests for message accumulation buffer in tests/unit/ssh-agent-protocol.test.ts — test feeding partial data across multiple calls, test complete message callback fires when full message accumulated, test multiple messages accumulated in one chunk, test buffer reset after message extraction

### Implementation for Foundational Phase

- [x] T005 Implement SSH string reader utility in src/services/ssh-agent-protocol.ts — `readSSHString(buf, offset)` returns `{ data: Buffer, bytesRead: number }`. Reads 4-byte big-endian uint32 length at offset, then extracts `length` bytes of data
- [x] T006 Implement message framing in src/services/ssh-agent-protocol.ts — `parseMessage(buf)` returns `{ type: number, payload: Buffer, totalLength: number } | null`. Returns null if buffer doesn't contain a complete message (less than 4 + length bytes)
- [x] T007 Implement message accumulation buffer in src/services/ssh-agent-protocol.ts — `MessageAccumulator` class with `feed(chunk: Buffer)` method and `onMessage(callback)`. Buffers incoming data, emits complete SSH agent messages via callback. Handles partial reads across multiple `feed()` calls

**Checkpoint**: Protocol parser can read, frame, and accumulate SSH agent binary messages

---

## Phase 3: User Story 1 — Agent Git Push Triggers Auth Request (Priority: P1) 🎯 MVP

**Goal**: Sandboxed agent runs `git push`, sign request is relayed over WebSocket, response completes the push

**Independent Test**: Set `SSH_AUTH_SOCK` to bridge socket. Run `ssh-add -L` (list keys) and verify it's forwarded. Trigger a mock sign request and verify it arrives on WebSocket with correct context.

### Tests for User Story 1

- [x] T008 [P] [US1] Write tests for SSH agent bridge lifecycle in tests/unit/ssh-agent-bridge.test.ts — test socket creation at correct path, test socket cleanup on destroy, test stale socket removal before creation, test socket permissions (0600), test pending request timeout (60s) returns FAILURE
- [x] T009 [P] [US1] Write tests for sign request parsing in tests/unit/ssh-agent-protocol.test.ts — test parsing type 13 message: extract key blob, data, and flags. Test extracting username and key algorithm from the data field's SSH userauth structure. Test fallback when data is not SSH userauth format
- [x] T010 [P] [US1] Write integration test for bridge end-to-end in tests/integration/ssh-agent-bridge.test.ts — create bridge, connect to Unix socket, send REQUEST_IDENTITIES (type 11), verify WebSocket receives `ssh-agent-request` message. Send mock response, verify Unix socket receives it. Test sign request (type 13) flow with mock response. Test cancel flow returns FAILURE to socket

### Implementation for User Story 1

- [x] T011 [US1] Implement sign request parser in src/services/ssh-agent-protocol.ts — `parseSignRequest(payload: Buffer)` returns `{ keyBlob: Buffer, data: Buffer, flags: number, username?: string, keyAlgorithm?: string }`. Parse the data field as SSH userauth structure to extract username and key algorithm. Return undefined for username/keyAlgorithm if data is not parseable as userauth
- [x] T012 [US1] Implement `detectSSHRemote(projectDir)` in src/services/ssh-agent-bridge.ts — run `git -C <dir> remote -v`, parse output for SSH URLs matching `git@host:path` or `ssh://host/path`. Return first SSH remote URL string or null. Use `child_process.execFileSync` (short-lived, not a long-running process)
- [x] T013 [US1] Implement SSH agent bridge service in src/services/ssh-agent-bridge.ts — `createBridge(options: { sessionId, dataDir, remoteContext, onRequest })` creates Unix socket at `<dataDir>/sessions/<sessionId>/agent.sock`, removes stale socket if exists, sets 0600 permissions. On connection: create MessageAccumulator, on complete message: check type against whitelist (11, 13). Whitelisted: generate UUID requestId, build context string using remoteContext + parsed username/algo, store PendingRequest, call `onRequest(request)`. Non-whitelisted: write FAILURE response to socket. Expose `handleResponse(requestId, data)` and `handleCancel(requestId)`. 60-second timeout per pending request. `destroy()` closes server, unlinks socket, fails all pending
- [x] T014 [US1] Add env var support to SandboxCommand in src/services/sandbox.ts — add optional `env?: Record<string, string>` to SandboxCommand interface. When SSH remote detected, set `SSH_AUTH_SOCK` to bridge socket path. Update `spawnProcess()` in src/services/process-manager.ts to merge `env` into child process environment via `spawn()` options
- [x] T015 [US1] Wire bridge into session launch in src/routes/sessions.ts — before spawning interview or task-run process: call `detectSSHRemote(project.dir)`. If SSH remote found: create bridge with `onRequest` callback that sends `ssh-agent-request` WebSocket message to session clients. Pass socket path as `SSH_AUTH_SOCK` env var to `buildCommand()`. Store bridge reference for cleanup. On session end: destroy bridge
- [x] T016 [US1] Wire bridge into spec-kit workflow session launch in src/routes/projects.ts — same as T015 but for the `runPhase()` callback used by add-feature and onboarding workflows

**Checkpoint**: Full server-side bridge works — agent's git push creates sign request, relayed over WebSocket, mock client can respond and push completes

---

## Phase 4: User Story 2 — List SSH Keys (Priority: P1)

**Goal**: `ssh-add -L` through the bridge returns the Yubikey's public key(s)

**Independent Test**: Set `SSH_AUTH_SOCK` to bridge socket. Send REQUEST_IDENTITIES. Verify IDENTITIES_ANSWER with key(s) is returned.

### Implementation for User Story 2

- [~] T017 [US2] Verify REQUEST_IDENTITIES (type 11) handling in bridge — already covered by T010 integration test (line 84): sends REQUEST_IDENTITIES, verifies onRequest callback, responds with IDENTITIES_ANSWER, verifies response written back to Unix socket

**Checkpoint**: Key listing works through the bridge

---

## Phase 5: User Story 3 — Protocol Message Whitelisting (Priority: P2)

**Goal**: Non-whitelisted message types are rejected with SSH_AGENT_FAILURE

**Independent Test**: Send type 18 (REMOVE_IDENTITY) to bridge socket. Verify FAILURE returned without WebSocket relay.

### Tests for User Story 3

- [x] T018 [P] [US3] Write tests for message type whitelisting in tests/unit/ssh-agent-bridge.test.ts — test that message types 17 (ADD_IDENTITY), 18 (REMOVE_IDENTITY), 19 (REMOVE_ALL), 22 (LOCK), 23 (UNLOCK) all return SSH_AGENT_FAILURE (type 5) without triggering onRequest callback. Test that types 11 and 13 do trigger onRequest

### Implementation for User Story 3

- [ ] T019 [US3] Verify whitelist enforcement in bridge — already implemented in T013. This task adds explicit test coverage for all non-whitelisted types listed in the SSH agent protocol spec and validates the FAILURE response format (`Buffer.from([0,0,0,1,5])`)

**Checkpoint**: Only list-keys and sign requests pass through. Everything else is rejected.

---

## Phase 6: User Story 4 — Sign Request Display Context (Priority: P2)

**Goal**: WebSocket message includes human-readable context about what is being signed

**Independent Test**: Trigger a sign request for a project with SSH remote `git@github.com:user/repo.git`. Verify WebSocket message `context` field contains the remote URL, username, and algorithm.

### Tests for User Story 4

- [ ] T020 [P] [US4] Write tests for context generation in tests/unit/ssh-agent-bridge.test.ts — test context string format for sign request with known remote ("Sign for git push to github.com:user/repo.git (user: git, algo: ecdsa-sha2-nistp256)"). Test context for list-keys request. Test fallback context when no remote context available

### Implementation for User Story 4

- [ ] T021 [US4] Implement context string builder in src/services/ssh-agent-bridge.ts — `buildRequestContext(messageType, remoteContext, signRequest?)` returns human-readable string. For type 13: include remote URL, username, and key algorithm from parsed sign request. For type 11: "List SSH keys for git push to <remote>". Fallback: "SSH sign request from sandboxed agent"

**Checkpoint**: Users can see meaningful descriptions of what they're authorizing

---

## Phase 7: User Story 5 — Multiple Concurrent Sessions (Priority: P3)

**Goal**: Multiple sessions can use SSH auth simultaneously with request ID correlation

**Independent Test**: Start two bridges. Send sign requests to both. Verify responses route to correct sockets.

### Tests for User Story 5

- [ ] T022 [P] [US5] Write test for concurrent bridge isolation in tests/integration/ssh-agent-bridge.test.ts — create two bridges with different sessionIds, send sign requests on both, respond to each with different data, verify correct responses arrive at correct Unix sockets

### Implementation for User Story 5

- [ ] T023 [US5] Verify concurrent bridge isolation — each bridge is independent (own socket, own pendingRequests map, own WebSocket routing via sessionId). This should already work from T013's design. This task validates with the integration test from T022 and fixes any issues found

**Checkpoint**: Multiple sessions can push simultaneously without cross-talk

---

## Phase 8: User Story 6 — WebSocket Message Handling (Priority: P1)

**Goal**: Session WebSocket handles ssh-agent-response and ssh-agent-cancel messages from client

**Independent Test**: Connect to session WebSocket, send `ssh-agent-response` message, verify bridge receives and writes to socket.

### Tests for User Story 6

- [ ] T024 [P] [US6] Write test for WebSocket ssh-agent message routing in tests/unit/ssh-agent-bridge.test.ts — test that `ssh-agent-response` messages are routed to correct bridge's `handleResponse()`. Test that `ssh-agent-cancel` messages are routed to `handleCancel()`. Test that messages with unknown requestId are silently dropped

### Implementation for User Story 6

- [ ] T025 [US6] Add ssh-agent message handlers to src/ws/session-stream.ts — on incoming `ssh-agent-response` message: look up bridge for the session, call `bridge.handleResponse(requestId, Buffer.from(data, 'base64'))`. On `ssh-agent-cancel`: call `bridge.handleCancel(requestId)`. If no bridge exists for session, silently drop. Add bridge registry (Map<sessionId, SSHAgentBridge>) accessible from session-stream

**Checkpoint**: Full bidirectional flow works — server → client (request) and client → server (response/cancel)

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Edge case handling, cleanup, documentation

- [ ] T026 [P] Add edge case handling for WebSocket disconnect during pending sign request — in ssh-agent-bridge.ts, if WebSocket client disconnects while a request is pending, fail the pending request with SSH_AGENT_FAILURE immediately (don't wait for timeout)
- [ ] T027 [P] Add edge case handling for malformed protocol data — in ssh-agent-protocol.ts, ensure `parseMessage()` and `parseSignRequest()` handle truncated/corrupt buffers without throwing. Return null/undefined for unparseable data, log warning
- [ ] T028 Update UI_FLOW.md with SSH agent bridge WebSocket message types and bridge lifecycle documentation
- [ ] T029 Run quickstart.md validation — execute manual testing commands from specs/005-ssh-agent-bridge/quickstart.md to verify Unix socket creation, SSH_AUTH_SOCK forwarding, and basic protocol handling

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 Git Push Auth (Phase 3)**: Depends on Foundational
- **US2 List Keys (Phase 4)**: Depends on US1 (reuses bridge infrastructure)
- **US3 Whitelisting (Phase 5)**: Depends on US1 (validates whitelist in existing code)
- **US4 Display Context (Phase 6)**: Depends on US1 (enhances context building)
- **US5 Concurrent Sessions (Phase 7)**: Depends on US1 (validates isolation)
- **US6 WebSocket Handling (Phase 8)**: Depends on US1 (completes bidirectional flow)
- **Polish (Phase 9)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — core MVP
- **US2 (P1)**: Depends on US1 — validates subset of US1 functionality
- **US3 (P2)**: Depends on US1 — tests whitelist already implemented in US1
- **US4 (P2)**: Depends on US1 — enhances context string generation
- **US5 (P3)**: Depends on US1 — validates design isolation
- **US6 (P1)**: Depends on US1 — completes the bidirectional WebSocket relay

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Protocol parsing before bridge service
- Bridge service before route integration
- Route integration before WebSocket handling

### Parallel Opportunities

- T002, T003, T004 (foundational tests) can run in parallel
- T008, T009, T010 (US1 tests) can run in parallel
- T018 (US3 test), T020 (US4 test), T022 (US5 test), T024 (US6 test) can all run in parallel after US1 implementation
- T026, T027 (polish) can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tests together:
Task T002: "Write tests for SSH string reader in tests/unit/ssh-agent-protocol.test.ts"
Task T003: "Write tests for message framing in tests/unit/ssh-agent-protocol.test.ts"
Task T004: "Write tests for message accumulation in tests/unit/ssh-agent-protocol.test.ts"
```

## Parallel Example: US1 Tests

```bash
# Launch all US1 tests together:
Task T008: "Write tests for bridge lifecycle in tests/unit/ssh-agent-bridge.test.ts"
Task T009: "Write tests for sign request parsing in tests/unit/ssh-agent-protocol.test.ts"
Task T010: "Write integration test for bridge e2e in tests/integration/ssh-agent-bridge.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US6)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002-T007)
3. Complete Phase 3: US1 — Bridge core (T008-T016)
4. Complete Phase 8: US6 — WebSocket handling (T024-T025)
5. **STOP and VALIDATE**: Test full flow with mock client

### Incremental Delivery

1. Setup + Foundational → Protocol parser ready
2. Add US1 → Bridge creates socket, relays requests
3. Add US6 → WebSocket bidirectional flow complete
4. Add US2 → Key listing verified
5. Add US3 → Whitelist hardened
6. Add US4 → Context display enriched
7. Add US5 → Concurrent session support verified
8. Polish → Edge cases, docs

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- The bridge is server-side only — client-side signing ships in 006-android-client
- SSH agent protocol is binary; all WebSocket messages use base64 encoding inside JSON
- Remote host context comes from `git remote -v`, NOT from the signed data
- Constitution VII requires test-first for all new modules
