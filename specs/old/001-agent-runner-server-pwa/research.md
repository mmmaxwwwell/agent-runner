# Research: Agent Runner Server and PWA System

**Date**: 2026-03-22 | **Branch**: `001-agent-runner-server-pwa`

## 1. Systemd Sandboxing (Process Isolation)

**Decision**: Use `systemd-run --user --scope` with `--property` flags for filesystem-only isolation.

**Rationale**: User-level systemd scopes provide effective filesystem isolation via `ProtectHome=tmpfs` and `BindPaths` without requiring root. Resource limits (CPU/memory cgroups) are not enforced at user level, but are not needed — we only need filesystem sandboxing per the spec.

**Command pattern**:
```bash
systemd-run --user --scope \
  --property='ProtectHome=tmpfs' \
  --property='BindPaths=<project-dir>' \
  --property='ProtectSystem=strict' \
  --property='PrivateDevices=yes' \
  --property='NoNewPrivileges=yes' \
  --property='PrivateTmp=yes' \
  nix develop <project-dir> --command claude <args>
```

**Chaining with Nix**: `nix develop` itself provides no sandboxing — it only sets up the environment. The `systemd-run` wrapper provides the actual isolation. The chain `systemd-run ... nix develop ... --command ...` works correctly.

**Runtime detection**: Check `command -v systemd-run` at startup. If unavailable, emit a visible warning (per constitution) and run unsandboxed.

**Alternatives considered**:
- Bubblewrap (`bwrap`): More portable but adds a dependency not in the Nix flake. Overkill for single-user local system.
- NixOS containers: Too heavy for per-session isolation.
- No sandboxing: Rejected — constitution mandates sandbox-first.

## 2. Session Log Format (JSONL)

**Decision**: Append-only JSONL files using `fs.createWriteStream()` with byte-offset tracking for replay.

**Rationale**: `createWriteStream` is non-blocking and handles concurrent appends safely. Byte offsets allow efficient seek-based replay without scanning the entire file.

**Log entry format**:
```json
{"ts":1711100000000,"stream":"stdout","content":"Working on task 1.1..."}
{"ts":1711100001000,"stream":"stderr","content":"Warning: deprecated API"}
{"ts":1711100002000,"stream":"system","content":"Session started"}
```

**Writing**: One `fs.createWriteStream` per session, append mode, flush on each write via `write()` callback.

**Replay (reconnect)**: Track byte offset per client. On reconnect, `fs.createReadStream({ start: byteOffset })` + `readline` to parse from that point. Then switch to live WebSocket streaming.

**Alternatives considered**:
- SQLite: Violates Markdown-as-Database principle (no parallel DB).
- Structured logging library (Pino): Adds dependency for session logs. Server operational logs (FR-016) can use Pino, but session capture is simpler — just append JSON lines.
- Line-number tracking: Byte offsets are more efficient (direct seek vs. counting lines).

## 3. WebSocket Streaming Architecture

**Decision**: Path-based routing with `ws` library, JSON envelope messages, server-initiated ping/pong.

**Rationale**: Path routing (`/ws/sessions/:id`) is the standard pattern for `ws` without Socket.IO. JSON envelope with `type` field enables extensible message handling.

**Message envelope**:
```json
{"type":"output","seq":42,"data":{"ts":1711100000000,"stream":"stdout","content":"..."}}
{"type":"state","data":{"state":"running","taskProgress":"14/18"}}
{"type":"input_needed","data":{"question":"What API key should I use?"}}
```

**Rooms/channels**: Maintain a `Map<sessionId, Set<WebSocket>>` for broadcasting. On connection to `/ws/sessions/:id`, add client to the session's set. On disconnect, remove.

**Reconnection**: Client sends `?lastSeq=N` query param on reconnect. Server replays from JSONL log (all entries with seq > N), then switches to live.

**Heartbeat**: Server sends WebSocket protocol-level `ping()` every 30 seconds. Mark connection dead after 3 missed pongs.

**Alternatives considered**:
- Socket.IO: Violates constitution (ws library mandated). Adds significant bundle size.
- SSE (Server-Sent Events): One-directional only — can't receive user input on same connection.
- Custom multiplexing: Unnecessary complexity for ~5-10 concurrent sessions.

## 4. Web Push Notifications

**Decision**: `web-push` npm library with VAPID keys, service worker for notification display.

**Rationale**: Standard Web Push protocol with self-hosted VAPID keys. No third-party push service needed.

**Setup**:
- Generate VAPID keys once (`web-push generate-vapid-keys`), store in env vars
- Server: `webpush.setVapidDetails()` + `webpush.sendNotification(subscription, payload)`
- Client: Service worker registers for push via `pushManager.subscribe()` with VAPID public key
- Payload limit: 4KB — sufficient for notification title + body + metadata

**HTTPS requirement**: Service workers register on localhost (secure context) without HTTPS. For LAN access from mobile, HTTPS is required. Options:
- Self-signed cert (user must trust it on device)
- Reverse proxy with Let's Encrypt (if exposed publicly)
- For MVP: document this constraint, don't solve it in code

**Alternatives considered**:
- Polling from PWA: Wastes battery, adds latency. Push is the right answer.
- WebSocket-based notifications: Works when app is open, but push notifications work when app is closed/backgrounded.
- ntfy.sh: External dependency, not self-hosted.

## 5. Task File Parsing

**Decision**: Regex-based parser for agent-framework `*-tasks.md` files with four status markers.

**Rationale**: Task files follow a well-defined format with checkbox-style markers. A simple regex parser handles all cases without external dependencies.

**Status markers**:
| Pattern | Meaning |
|---------|---------|
| `- [ ]` | Not started (unchecked) |
| `- [x]` | Completed |
| `- [?]` | Blocked (has question) |
| `- [~]` | Skipped/unnecessary |

**Parsing regex**: `/^(\s*)- \[([ x?~])\] (\d+(?:\.\d+)*) (.+)$/` captures:
- Group 1: Indentation (2 spaces per nesting level)
- Group 2: Status character
- Group 3: Task ID (e.g., `1.1`, `2.3.1`)
- Group 4: Description (may contain ` — Done:`, ` — Blocked:`, ` — Skipped:` suffixes)

**Phase detection**: `## Phase N: <name>` headers group tasks. Task IDs must match phase number.

**Completion detection**: All tasks are `[x]` or `[~]` → project complete. Any `[?]` → waiting for input.

**Auto-loop logic**: After a task-run completes, re-parse the file. If unchecked tasks remain and no `[?]` blockers exist, start next run. If `[?]` found, emit `waiting_for_input`. If all done, mark session complete.

**Alternatives considered**:
- AST-based markdown parser (remark/unified): Overkill for checkbox extraction. Adds dependencies.
- Store parsed tasks in DB: Violates Markdown-as-Database principle.

## 6. Server Operational Logging

**Decision**: Use `pino` for structured JSON logging to stderr, 5 levels, configurable at runtime.

**Rationale**: Pino is the fastest Node.js JSON logger. Structured output to stderr keeps it separate from session JSONL logs. Runtime level configuration via env var (`LOG_LEVEL`) or API endpoint.

**Log format**:
```json
{"level":30,"time":1711100000000,"msg":"Session started","component":"session-manager","sessionId":"abc-123","projectId":"proj-1"}
```

**Components**: server, session-manager, process-spawner, sandbox, websocket, push, voice, task-parser.

**Alternatives considered**:
- Winston: Slower than Pino, more features we don't need.
- Console.log: Not structured, not parseable.
- Custom logger: Reinventing the wheel.

## 7. PWA Client Technology

**Decision**: Vanilla JS with Web Components, served as static files. No build toolchain.

**Rationale**: Constitution mandates "Vanilla JS or Preact, no build toolchain." Vanilla JS with Web Components provides component encapsulation without a framework dependency or build step.

**Structure**:
- `public/` directory served by the Node.js server
- `index.html` as the shell, `manifest.json` for installability
- `sw.js` service worker for push notifications + offline caching
- ES modules (`<script type="module">`) for code organization
- CSS custom properties for theming

**Alternatives considered**:
- Preact: Constitution allows it, but adds a dependency and either requires a build step or uses htm (tagged template alternative to JSX). Vanilla JS is simpler for the ~8 screens we need.
- React/Vue/Svelte: All require build toolchains. Rejected.

## 8. Session State Persistence & Crash Recovery

**Decision**: Per-session `meta.json` file with lifecycle state, restored on server startup.

**Rationale**: Each session directory contains a `meta.json` with its state (running/waiting-for-input/completed/failed). On startup, the server scans for sessions in `running` or `waiting-for-input` state and resumes them.

**Recovery logic**:
- `running` → Re-spawn the agent process, resume from last task
- `waiting-for-input` → Restore the waiting state, display the question to the user
- `completed`/`failed` → No action (historical records)

**Session directory layout**:
```
~/.agent-runner/sessions/<session-id>/
├── meta.json    # {id, projectId, type, state, startedAt, pid, ...}
└── output.jsonl # Append-only session log
```

**Alternatives considered**:
- SQLite for session state: Violates Markdown-as-Database principle.
- In-memory only: Lost on crash. Constitution requires crash recovery.
