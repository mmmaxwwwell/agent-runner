# Agent Runner — Tasks

## Status key
- `- [ ]` — not started
- `- [x]` — completed
- `- [?]` — blocked (see reason)
- `- [~]` — skipped / unnecessary (see reason)

## Phase 1: Project scaffolding
- [ ] 1.1 Initialize Node.js project with TypeScript. Create `package.json`, `tsconfig.json`, and `flake.nix` (Node 22 dev environment). Set up `server/` and `pwa/` directory structure. Install Express, ws, uuid, and TypeScript dev dependencies.
- [ ] 1.2 Create the project registry module (`server/lib/project-registry.ts`) — read/write `~/.agent-runner/projects.json`. CRUD operations for projects (add, remove, list, get). Create the `~/.agent-runner/` directory on first run if it doesn't exist. Each project entry: `{ id, name, path, promptFile, createdAt }`.
- [ ] 1.3 Create the task parser module (`server/lib/task-parser.ts`) — parse agent-framework `*-tasks.md` files. Extract tasks with their status (`[ ]`, `[x]`, `[?]`, `[~]`), task ID, description, and any blocked reason. Return summary stats (total, completed, blocked, skipped, remaining).

## Phase 2: Process management & sandboxing
- [ ] 2.1 Create the sandbox module (`server/lib/sandbox.ts`) — build the `systemd-run` command for spawning sandboxed processes. Takes project path and the command to run. Returns the full shell command string. Include a `--no-sandbox` flag for development/testing.
- [ ] 2.2 Create the session logger module (`server/lib/session-logger.ts`) — manages log files at `~/.agent-runner/sessions/<session-id>/output.log`. Write output chunks, read full log for replay, stream new chunks from a position offset. Store session metadata (id, projectId, type, state, timestamps) in a `meta.json` alongside the log.
- [ ] 2.3 Create the process manager module (`server/lib/process-manager.ts`) — spawn claude processes via `child_process.spawn`, pipe through sandbox command, capture stdout/stderr to session logger, handle stdin for interactive sessions. Track running processes. Support killing a process. Emit events: `output`, `state-change`, `exit`.
- [ ] 2.4 Implement the task-run loop logic in process manager — when a task-run session completes, parse the task file. If unchecked tasks remain and no `[?]` blockers, auto-start next run. If `[?]` tasks exist, emit `waiting_for_input`. If output contains `DONE` or all tasks checked, mark complete.

## Phase 3: Server API
- [ ] 3.1 Create Express server entry point (`server/index.ts`) — set up Express app, WebSocket server (ws), CORS, JSON body parsing. Serve PWA static files from `pwa/`. Wire up route modules.
- [ ] 3.2 Create project routes (`server/routes/projects.ts`) — `GET /api/projects` (list with task summaries), `POST /api/projects` (register), `DELETE /api/projects/:id` (unregister), `GET /api/projects/:id` (detail with full task list), `POST /api/projects/:id/run` (start task-run), `POST /api/projects/:id/stop` (kill session).
- [ ] 3.3 Create session routes (`server/routes/sessions.ts`) — `GET /api/sessions` (list, filterable by project/state), `GET /api/sessions/:id` (detail with log content).
- [ ] 3.4 Create interview routes (`server/routes/interviews.ts`) — `POST /api/interviews` (start generator interview, takes project name and target directory). Server spawns interactive claude with generator-prompt.md piped as first message.
- [ ] 3.5 Create WebSocket handler (`server/ws/handler.ts`) — handle subscribe/unsubscribe to sessions (with log replay), input messages for interviews, answer messages for blocked tasks. Broadcast output chunks, state changes, and question notifications to subscribed clients.

## Phase 4: PWA client
- [ ] 4.1 Create PWA shell — `index.html` (app shell with viewport meta, manifest link, service worker registration), `manifest.json` (name, icons, display: standalone, theme color), basic `sw.js` (cache app shell for offline). Dark theme styling in `styles/app.css`.
- [ ] 4.2 Create project dashboard (`pwa/components/project-list.js`) — fetch projects from API, render list with name, task progress bar, state badge (idle/running/waiting). Tap to open project detail. "New Project" button.
- [ ] 4.3 Create session view (`pwa/components/session-view.js`) — connect to WebSocket, subscribe to session. Display output in a terminal-like monospace scrolling container. Auto-scroll to bottom. Handle log replay (historical data) then live streaming. Show session state.
- [ ] 4.4 Create voice input component (`pwa/components/voice-input.js`) — mic button using Web Speech API (`webkitSpeechRecognition`). Show listening state, display interim transcription. On final result, send text to server via WebSocket. Fallback to text input if speech not supported.
- [ ] 4.5 Create notification manager (`pwa/components/notification-manager.js`) — request notification permission, handle push events in service worker. Show notifications for: task blocked (`[?]`), project completed, session failed. Tap notification opens relevant project/session.
- [ ] 4.6 Wire up interview flow — "New Project" → enter project name + target directory → start interview session → session view with voice input active → when interview completes, project appears in dashboard.
- [ ] 4.7 Wire up answer flow — when a project is `waiting_for_input`, show the blocked task question prominently. Voice or text input → send answer via WebSocket → server updates task file and re-runs.

## Phase 5: Integration & polish
- [ ] 5.1 End-to-end test — register an existing agent-framework project (e.g., the blog project), trigger a task run from the PWA, verify sandbox works, output streams, log persists across reconnect.
- [ ] 5.2 End-to-end test — start a generator interview from the PWA with voice input, complete the interview, verify the 3 files are created and the project is registered.
- [ ] 5.3 Handle edge cases — claude process crashes, systemd-run not available (fallback to unsandboxed with warning), project directory doesn't exist, task file parse errors, WebSocket disconnects mid-session.
- [ ] 5.4 Write README.md — setup instructions (Nix flake, npm install, start server), how to register projects, how to use the PWA, architecture overview.
