## Code Review: 004-onboarding-overhaul (Node.js)

**Scope**: 137 files changed, +30695/-93 lines | **Base**: `74bb346~1`
**Commits**: T001–T039 — onboarding overhaul: data dir migration, agent-framework management, unified onboard endpoint, interview pipeline, transcript parser, git remote setup, client API updates
**Stack**: Node.js `http` (raw) + `ws` (WebSocket) + TypeScript 5.9

### Findings

| # | Sev | Category | File:Line | Finding | Suggested fix | Confidence |
|---|-----|----------|-----------|---------|---------------|------------|
| 1 | P0 | Node Security | src/services/onboarding.ts:55,95 | `VALID_PROJECT_NAME` regex `/^[a-zA-Z0-9._-]+$/` accepts `..` — `join(projectsDir, '..')` escapes the projects directory, creating files in the parent. | Reject names containing consecutive dots: `/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/` and add explicit `..` check, or use `basename()` on the result and compare. | 95 |
| 2 | P1 | Async/Event Loop | src/ws/session-stream.ts:105-153 | `readAndBroadcast` uses synchronous `statSync`/`openSync`/`readSync`/`closeSync` inside a 50ms `setInterval` poller. With multiple active sessions, this blocks the event loop on every tick. | Convert to async `fs/promises` operations, or at minimum increase poll interval and batch reads. Comment says "avoid readline stream lifecycle issues" — consider a single worker thread for all session polling. | 92 |
| 3 | P1 | Async/Event Loop | src/services/transcript-parser.ts:72-143 | Same pattern — synchronous `statSync`/`openSync`/`readSync`/`closeSync` plus `appendFileSync` in an 80ms poll loop. Each active interview blocks the event loop during its poll. | Convert to async I/O. The `reading` guard prevents overlapping polls but doesn't prevent blocking. | 90 |
| 4 | P1 | Error Handling | src/services/process-manager.ts:48 | No `child.on('error', ...)` handler on spawned process. If the command doesn't exist (e.g., `systemd-run` missing), Node emits an unhandled `'error'` event that crashes the process. | Add `child.on('error', (err) => { log.error(...); resolve({ exitCode: 1, signal: null }); })` before the `close` handler. | 95 |
| 5 | P1 | Performance | src/routes/projects.ts:59-93 | `listSessionsForProject` does synchronous `readdirSync` + `readFileSync` for every session directory to filter by projectId. Called on every `GET /api/projects/:id`. O(total sessions) per request. | Maintain a projectId→sessionId index, or at minimum use async I/O and cache results with a short TTL. | 85 |
| 6 | P1 | Performance | src/routes/projects.ts:592-610 | Synchronous `readdirSync`, `statSync`, `readFileSync` in a request handler (description extraction). Blocks event loop while scanning spec directories. | Use async `readdir`/`stat`/`readFile` from `fs/promises`. | 85 |
| 7 | P1 | Error Handling | src/services/onboarding.ts:259 | `handle.waitForExit().then(() => parser.stop())` — fire-and-forget with no `.catch()`. If the exit promise rejects, `parser.stop()` is never called, leaking the poll timer indefinitely. | Add `.catch((err) => { parser.stop(); log.error(...); })`. | 90 |
| 8 | P2 | Security | src/routes/projects.ts:30-37 | `readBody()` accumulates request body into a string with no size limit. An attacker can send an arbitrarily large body to cause OOM. The voice route has a 10MB limit but other routes don't. | Add a max body size (e.g., 1MB for JSON endpoints): reject and destroy the socket if exceeded. | 80 |
| 9 | P2 | Async/Event Loop | src/routes/sessions.ts:195-199 | `writeFileSync` in a request handler to update session meta.json with PID. Blocks event loop. | Use `writeFile` from `fs/promises`. | 80 |
| 10 | P2 | Error Handling | src/routes/sessions.ts:202-213 | `handle.waitForExit().then(...)` — if `transitionState` or `broadcastSessionState` throws inside `.then()`, the error propagates as an unhandled rejection. `unregisterProcess` in `.catch()` is duplicated but doesn't protect against throws in the success path. | Wrap the `.then()` body in try-catch, or use async/await with a top-level catch. | 80 |
| 11 | P2 | Node Security | src/services/sandbox.ts:89 | `bindPaths` joined with spaces and passed as a single `--property=BindPaths=` value. If `projectDir` or `homedir()` contain spaces, systemd-run will misinterpret the bind mounts. | Quote individual paths or use separate `--property=BindPaths=` args per path. | 75 |
| 12 | P2 | Error Handling | src/services/session-logger.ts:25 | `createWriteStream` has no `.on('error', ...)` handler. If the underlying file becomes unwritable (disk full, permissions), the stream emits an unhandled error event. | Add `ws.on('error', (err) => { ... })` after creation. | 80 |
| 13 | P2 | Resource Leak | src/services/process-manager.ts:58-73 | Two `readline` interfaces created for stdout/stderr are never explicitly closed. They'll be GC'd when the child process streams close, but explicit cleanup prevents leaks if the child is killed abruptly. | Close readline interfaces in the `child.on('close', ...)` handler. | 70 |

### Summary

- **P0**: 1 critical issue (path traversal via `..` project name)
- **P1**: 5 high issues (sync I/O blocking event loop, missing process error handler, fire-and-forget without catch)
- **P2**: 7 medium issues (no body size limit, more sync I/O, error handling gaps, resource leaks)

### What looks good

The onboarding pipeline design with step-based `check()`/`run()` is clean and extensible. Session logging with JSONL and sequential sequence numbers is a solid approach for streaming. The project name validation catches most cases and the `VALID_TRANSITIONS` state machine pattern in the project model is well-structured. Test coverage across unit, integration, and contract layers is thorough.
