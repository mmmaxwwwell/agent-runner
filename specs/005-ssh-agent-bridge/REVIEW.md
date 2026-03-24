## Code Review: 005-ssh-agent-bridge (Node.js)

**Scope**: 14 files changed, +2104/-37 lines | **Base**: f7f02d2
**Commits**: T001–T029 — SSH agent protocol parser, Unix socket bridge service, WebSocket relay, session/route integration, tests
**Stack**: Node.js built-in `net` + `crypto` + TypeScript

### Findings

| # | Sev | Category | File:Line | Finding | Suggested fix | Confidence |
|---|-----|----------|-----------|---------|---------------|------------|
| 1 | P1 | Stream Error Handling | src/services/ssh-agent-bridge.ts:95 | `clientSocket` from `net.createServer` has no `error` event handler. If the client disconnects mid-request (e.g., agent process killed), the unhandled `error` event will crash the Node.js process. | Add `clientSocket.on('error', (err) => { log.debug({ err }, 'SSH agent client socket error'); });` inside the connection callback, before registering the `data` handler. | 90 |
| 2 | P2 | Error Handling | src/services/ssh-agent-bridge.ts:164 | `handleResponse()` calls `clientSocket.write()` without try-catch. If the socket closed between request and response, this throws. `handleCancel()` (line 173) and `failAllPending()` (line 179) both have try-catch guards, but `handleResponse` does not. | Wrap `pending.clientSocket.write(...)` in try-catch, consistent with the cancel/failAll paths. | 85 |
| 3 | P2 | Correctness | src/services/ssh-agent-bridge.ts:78 | `buildRequestContext` for `SSH_AGENTC_REQUEST_IDENTITIES` (type 11) with no remote context returns `"SSH sign request from sandboxed agent"` — this is a list-keys request, not a sign request. The fallback message is misleading. | Change to `"SSH key listing from sandboxed agent"` or `"List SSH keys (no remote detected)"`. | 90 |

### Summary

- **P0**: 0 critical issues
- **P1**: 1 high issue
- **P2**: 2 medium issues

### What looks good

The SSH agent protocol parser is well-structured with clean separation between wire-format parsing (`ssh-agent-protocol.ts`) and bridge lifecycle management (`ssh-agent-bridge.ts`). The message type whitelist is a strong security decision — only forwarding types 11 and 13 while rejecting all others. Test coverage is thorough across unit, integration, and edge cases (concurrent bridges, timeout behavior, partial buffers). The bridge cleanup on session end is consistent across all code paths (normal exit, error, manual stop, WebSocket disconnect).
