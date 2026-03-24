# Implementation Plan: SSH Agent WebSocket Bridge

**Branch**: `005-ssh-agent-bridge` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-ssh-agent-bridge/spec.md`

## Summary

Add a server-side SSH agent protocol proxy that creates per-session Unix sockets, parses the SSH agent binary protocol (message types 11 and 13 only), and relays sign requests over WebSocket to the connected client for remote Yubikey authorization. This feature delivers the server-side bridge — the client-side signing implementation (Android app with Yubikey PIV) ships in 006-android-client.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (via Nix flake)
**Primary Dependencies**: `ws` (WebSocket), `net` (Node.js built-in for Unix sockets), `crypto` (UUID generation)
**Storage**: Unix socket files at `<dataDir>/sessions/<sessionId>/agent.sock`
**Testing**: Node.js built-in test runner (`node:test`), `assert`
**Target Platform**: NixOS (Linux), systemd-run --user sandbox
**Project Type**: Web service extension
**Performance Goals**: Sign request roundtrip < 60 seconds (timeout)
**Constraints**: SSH agent protocol is binary; WebSocket carries JSON with base64-encoded binary. Unix socket path limit ~107 bytes.
**Scale/Scope**: 1 bridge per active session, max 1 concurrent signing operation per session typical

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Sandbox-First Security | PASS | Socket bound into sandbox via BindPaths. Only whitelisted message types forwarded. |
| II. Markdown-as-Database | PASS | No new database. Socket is ephemeral runtime state. |
| III. Thin Client | PASS | Client only relays Yubikey responses. All protocol parsing is server-side. |
| IV. NixOS-Native | PASS | Uses Node.js built-in `net` module. No new dependencies. |
| V. Simplicity & YAGNI | PASS | Hand-written parser for 2 message types. No abstraction layers. |
| VI. Process Isolation | PASS | Each session gets its own Unix socket. No shared state. |
| VII. Test-First | PASS | Tests for protocol parsing, bridge lifecycle, WebSocket relay. |

## Project Structure

### Documentation (this feature)

```text
specs/005-ssh-agent-bridge/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── websocket-api.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── ssh-agent-protocol.ts      # NEW — Binary protocol parsing
│   ├── ssh-agent-bridge.ts        # NEW — Unix socket server, WebSocket relay
│   └── sandbox.ts                 # MODIFY — add env vars support, SSH_AUTH_SOCK
├── routes/
│   ├── projects.ts                # MODIFY — detect SSH remote, create bridge
│   └── sessions.ts                # MODIFY — detect SSH remote, create bridge
├── ws/
│   └── session-stream.ts          # MODIFY — handle ssh-agent-response/cancel
└── services/
    └── process-manager.ts         # MODIFY — pass env vars to spawned process

tests/
├── unit/
│   ├── ssh-agent-protocol.test.ts # NEW
│   └── ssh-agent-bridge.test.ts   # NEW
└── integration/
    └── ssh-agent-bridge.test.ts   # NEW
```

**Structure Decision**: Two new service modules. `ssh-agent-protocol.ts` handles pure binary parsing (no I/O, fully testable). `ssh-agent-bridge.ts` handles socket lifecycle and WebSocket relay.

## Complexity Tracking

No constitution violations requiring justification.

## Implementation Approach

### Phase 1: Protocol Parser

1. **SSH agent protocol utilities** — `ssh-agent-protocol.ts`:
   - SSH string reader: read 4-byte big-endian length + data from Buffer
   - Message framing: extract complete messages from a byte stream (accumulation buffer)
   - Message type extraction from first byte after length prefix
   - Parse SIGN_REQUEST (type 13): extract key blob, data, flags
   - Extract username and key algorithm from sign request data field
   - Construct FAILURE response: `Buffer.from([0,0,0,1,5])`
   - Constants for all whitelisted message types

### Phase 2: Bridge Service

2. **SSH agent bridge** — `ssh-agent-bridge.ts`:
   - `createBridge(options)` → SSHAgentBridge instance
   - Creates Unix socket at `<dataDir>/sessions/<sessionId>/agent.sock`
   - Sets permissions to 0600
   - On connection: run message accumulation loop, parse type, whitelist check
   - Whitelisted types (11, 13): generate UUID requestId, store PendingRequest, emit via callback
   - Non-whitelisted: return SSH_AGENT_FAILURE immediately
   - `handleResponse(requestId, data)`: write SSH agent response to Unix socket, clear pending
   - `handleCancel(requestId)`: write FAILURE to Unix socket, clear pending
   - 60-second timeout per request (auto-fail)
   - `destroy()`: close server, unlink socket, fail all pending requests

3. **SSH remote detection**:
   - `detectSSHRemote(projectDir)` → `string | null`
   - Run `git -C <dir> remote -v`, parse for `git@host:path` or `ssh://` URLs
   - Return first SSH remote URL found

### Phase 3: Integration

4. **Sandbox env support** — Modify `SandboxCommand` to include optional `env` record. Modify `buildCommand()` to accept env vars. When SSH remote detected, set `SSH_AUTH_SOCK` to bridge socket path.

5. **Process spawning env** — Modify `spawnProcess()` to merge additional env vars into the child process environment.

6. **Session launch** — In routes (projects.ts, sessions.ts):
   - Before spawning: call `detectSSHRemote(projectDir)`
   - If SSH remote found: create bridge, register it, pass socket path
   - Bridge's `onRequest` callback sends WebSocket message to session clients

7. **WebSocket handling** — In session-stream.ts:
   - On `ssh-agent-response` message: look up bridge for session, call `handleResponse()`
   - On `ssh-agent-cancel` message: look up bridge, call `handleCancel()`

### Phase 4: Cleanup

8. **Bridge lifecycle** — Destroy bridge on session end (completed/failed/stopped). Ensure socket file is removed. Fail any pending requests.

9. **Spec FR-009 adjustment** — Remote host context comes from `detectSSHRemote()` at session creation, not from parsing the signed data (the signed data contains an opaque session hash, not the hostname).
