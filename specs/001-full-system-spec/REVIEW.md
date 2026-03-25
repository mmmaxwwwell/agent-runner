## Code Review: main (Node.js)

**Scope**: 191 files changed, +39982/-1966 lines | **Base**: `74bb346~1`
**Commits**: T001–T048 — full system implementation (server, PWA client, SSH agent bridge, Android client, test infrastructure)
**Stack**: Node.js 22 (raw `http`) + `ws` (WebSocket) + `pino` (logging) + `preact` (PWA) + TypeScript 5.9

### Findings

| # | Sev | Category | File:Line | Finding | Suggested fix | Confidence |
|---|-----|----------|-----------|---------|---------------|------------|
| 1 | P1 | HTTP Framework | src/routes/projects.ts:31 | `readBody()` accumulates request body with no size limit. Same pattern in sessions.ts:101 and push.ts:13. An attacker (or misconfigured client) can send an arbitrarily large payload and exhaust server memory. The voice route correctly uses `readRawBody()` with a 10MB cap — the JSON routes do not. | Add a `maxBytes` parameter (e.g. 1MB) and destroy the request if exceeded, matching the pattern in voice.ts:15-31. | 95 |
| 2 | P1 | Async/Event Loop | src/ws/session-stream.ts:117 | `readAndBroadcast()` uses `statSync`, `openSync`, `readSync`, `closeSync` on the main event loop, called every 50ms per active session via `setInterval`. With multiple active sessions this will block the event loop and degrade WebSocket responsiveness. | Replace with async equivalents (`fs/promises`) or offload to a worker. The `reading` flag already serializes calls — async I/O fits naturally. | 92 |
| 3 | P1 | Async/Event Loop | src/services/ssh-agent-bridge.ts:224 | `execFileSync('git', ...)` blocks the event loop for up to 5 seconds. Called from `setupBridge()` on every session start for projects with git remotes. | Use `execFile` (async callback or promisified) instead of `execFileSync`. | 90 |
| 4 | P2 | Node Security | src/routes/voice.ts:110 | Google STT API key is embedded in the URL query string: `` `...?key=${cfg.googleSttApiKey}` ``. Query strings appear in server access logs, browser history, and proxy logs. | Use a request header (`x-goog-api-key`) or POST body for the API key. Google's REST API supports the `key` header. | 88 |
| 5 | P2 | Security | src/lib/config.ts:60-64 | VAPID private key is written to `vapid-keys.json` using default file permissions (umask-dependent, typically 0644). On multi-user systems the private key is world-readable. | Pass `{ mode: 0o600 }` as the options argument to `writeFileSync`. | 85 |
| 6 | P2 | Correctness | src/services/sandbox.ts:94 | `bindPaths` are space-joined: `[projectDir, ...].join(' ')`. If `projectDir` contains spaces (e.g. `/home/user/my project`), systemd-run will interpret it as two separate paths, breaking the sandbox and potentially exposing unintended directories. | Use systemd's colon-separated `BindPaths` syntax (e.g. `path1 path2` → `path1:path1 path2:path2`) or escape spaces, or emit one `--property=BindPaths=` per path. | 82 |
| 7 | P2 | Resource Leak | src/ws/session-stream.ts:189 | `ensureWatcher()` starts a 50ms `setInterval` poller that is only cleaned up when all WebSocket clients disconnect (`cleanupWatcher`). If a session ends but the WebSocket client never connects (e.g. fire-and-forget task-run), the poller runs indefinitely. | Add a session-end hook (on process exit or state transition to completed/failed) that calls `cleanupWatcher`. | 78 |
| 8 | P2 | Error Handling | src/services/onboarding.ts:175 | `ctx.remoteUrl` is passed directly to `execFileSync('git', [..., ctx.remoteUrl])` without URL format validation. While `execFileSync` with array args prevents shell injection, a malformed URL could trigger unexpected git behavior or confusing error messages. | Validate `remoteUrl` matches a git remote URL pattern (e.g. `^(https?://|git@|ssh://)`) before passing to git. | 75 |
| 9 | P2 | Correctness | src/services/transcript-parser.ts:41-50 | Byte-offset reads (`readSync` at arbitrary offset) can split multi-byte UTF-8 sequences, corrupting characters at chunk boundaries. The resulting string will contain replacement characters or throw. | Read to the nearest newline boundary, or use a streaming line reader that handles partial reads. | 78 |

### Summary

- **P0**: 0 critical issues
- **P1**: 3 high issues
- **P2**: 6 medium issues

### What looks good

The codebase demonstrates solid architecture: proper state machines for session lifecycle, good use of `execFileSync`/`execFile` with argument arrays (avoiding shell injection), consistent structured logging with pino, backpressure handling on WebSocket sends, heartbeat-based dead connection cleanup, and a well-designed SSH agent bridge with request timeouts and cleanup. The voice route's `readRawBody()` with size limits shows the right pattern — it just needs to be applied consistently to the JSON body readers. The static file server correctly guards against path traversal. Test coverage is comprehensive at 633+ Node.js tests across unit, integration, and contract layers.
