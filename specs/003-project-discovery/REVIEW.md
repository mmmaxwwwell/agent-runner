## Code Review: 004-project-discovery (Node.js)

**Scope**: 90 files changed, +22714/-83 lines | **Base**: `74bb346~1` (pre-initial commit)
**Commits**: 80 commits — full project buildout: HTTP server, WebSocket streaming, session management, process spawning, task loop, push notifications, voice transcription, project discovery, PWA client
**Stack**: Node.js 22 (raw `http`) + `ws` + `pino` + `preact` (client) + `web-push` | TypeScript 5.9

### Findings

| # | Sev | Category | File:Line | Finding | Suggested fix | Confidence |
|---|-----|----------|-----------|---------|---------------|------------|
| 1 | P1 | HTTP Framework | src/routes/projects.ts:28, src/routes/sessions.ts:27, src/routes/push.ts:13 | `readBody()` accumulates request body with no size limit. An attacker (or buggy client) can send a multi-GB JSON body to any POST endpoint and exhaust server memory. `voice.ts` correctly limits to 10MB but these three copies do not. | Add a `maxBytes` parameter (e.g. 1MB) and destroy the request if exceeded, matching the pattern in `readRawBody` in `voice.ts`. | 90 |
| 2 | P1 | Correctness | src/services/session-logger.ts:26 | `createSessionLogger()` always starts `seq` at 0. When a new logger is created for the same session (e.g. after user input at `sessions.ts:346`, or recovery at `recovery.ts:90`), seq numbers restart from 1, duplicating earlier entries. Clients filtering by `afterSeq` (session-stream.ts:241) will silently miss new entries whose seq ≤ their last-seen seq. | Read the existing log file on logger creation and initialize `seq` to the max existing seq value (or count of lines). | 92 |
| 3 | P1 | Event Loop | src/ws/session-stream.ts:105-153 | `readAndBroadcast()` uses synchronous I/O (`statSync`, `openSync`, `readSync`, `closeSync`) and is called every 50ms via `setInterval`. With multiple active sessions this blocks the event loop on every tick, adding latency to all concurrent HTTP/WS handlers. | Replace with async I/O (`fs/promises`) or use `fs.watch`/`fs.watchFile` instead of polling. If sync is intentional for simplicity, at minimum increase the poll interval (250-500ms). | 88 |
| 4 | P2 | Race Condition | src/models/project.ts:38-48 | `readProjects()` → modify → `writeProjects()` is not atomic. Concurrent API requests (e.g. two `POST /api/projects` calls) can both read the same array and one write overwrites the other's changes. Same pattern in `session.ts` for meta.json but lower risk since session IDs are unique. | Use a write lock (e.g. a simple async mutex), or use `rename()` for atomic file replacement. For a single-user local tool this is low-risk but could bite during recovery or concurrent workflows. | 75 |
| 5 | P2 | Correctness | src/services/process-manager.ts:52 | `child.pid!` non-null assertion — `spawn()` can return `undefined` for `pid` if the process fails to launch (e.g. command not found, EMFILE). This would propagate `undefined` as the PID and later cause confusing behavior. | Check `child.pid` before proceeding; if undefined, reject or return an error result. | 78 |
| 6 | P2 | Code Quality | src/routes/projects.ts:253,488 | `currentSessionId` is assigned in `onPhaseTransition` callbacks but never read anywhere. Dead variable in both the add-feature and new-project workflow setup blocks. | Remove the variable or use it (e.g. for broadcasting to the correct session). | 85 |

### Summary

- **P0**: 0 critical issues
- **P1**: 3 high issues
- **P2**: 3 medium issues

### What looks good

The architecture is clean and well-structured — clear separation between routes, models, services, and WebSocket handlers. The sandbox two-gate mechanism (`ALLOW_UNSANDBOXED` server env + per-request flag) is a thoughtful security pattern. The session state machine with explicit valid transitions prevents illegal state changes. Backpressure handling on WebSocket broadcasts and heartbeat-based dead connection cleanup are solid production patterns.
