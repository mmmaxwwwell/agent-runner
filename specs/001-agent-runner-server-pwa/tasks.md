# Tasks: Agent Runner Server and PWA System

**Input**: Design documents from `/specs/001-agent-runner-server-pwa/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

**Tests**: Included — constitution principle VII mandates test-first (red-green-refactor).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dev environment, and build tooling

- [x] T001 Initialize Node.js project with package.json (type: module, engines: node >=22) and install dependencies: ws, web-push, pino, preact, and dev dependencies: typescript, tsx, esbuild, @types/node, @types/ws in package.json
- [x] T002 Configure TypeScript with tsconfig.json (target ES2022, module NodeNext, outDir dist/, rootDir src/, strict mode, jsxImportSource preact)
- [x] T003 [P] Add npm scripts to package.json: build (tsc && esbuild src/client/app.tsx --bundle --outdir=public/), dev (tsx watch src/server.ts), build:client (esbuild src/client/app.tsx --bundle --outdir=public/ --watch), start (node dist/server.js), test (tsx --test tests/**/*.test.ts)
- [x] T004 [P] Create project directory structure: src/models/, src/services/, src/routes/, src/ws/, src/lib/, src/client/components/, src/client/lib/, public/, tests/unit/, tests/integration/, tests/contract/

**Checkpoint**: Project compiles with `npm run build` and `npm test` runs (no tests yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement environment config loader in src/lib/config.ts — read AGENT_RUNNER_HOST (default 127.0.0.1), AGENT_RUNNER_PORT (default 3000), AGENT_RUNNER_DATA_DIR (default ~/.agent-runner), AGENT_RUNNER_PROJECTS_DIR (required), LOG_LEVEL (default info), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, ALLOW_UNSANDBOXED (default false), GOOGLE_STT_API_KEY (optional), DISK_WARN_THRESHOLD_MB (default 8192) per data-model.md env vars table. VAPID keys: env vars override vapid-keys.json; if neither exists, auto-generate to vapid-keys.json on first startup
- [x] T006 [P] Implement Pino structured logger in src/lib/logger.ts — JSON to stderr, child loggers with component field, runtime level change via setLevel(), levels: debug/info/warn/error/fatal per research.md §6
- [x] T007 [P] Write unit tests for config and logger in tests/unit/config.test.ts and tests/unit/logger.test.ts, including contract test for PUT /api/config/log-level endpoint
- [x] T008 Implement HTTP server entry point in src/server.ts — create http.createServer, serve static files from public/, mount /api routes, upgrade WebSocket connections, listen on configured host:port, log startup with pino
- [x] T009 Implement data directory initialization in src/server.ts startup — ensure AGENT_RUNNER_DATA_DIR, sessions/ subdirectory, projects.json (empty array if missing), push-subscriptions.json (empty array if missing) exist per data-model.md filesystem layout
- [x] T010 [P] Add health check endpoint GET /api/health in src/routes/health.ts — return { status: "ok", uptime, sandboxAvailable, cloudSttAvailable } per rest-api.md contract
- [~] T011 [P] Add PUT /api/config/log-level endpoint in src/routes/health.ts — validate level, call logger.setLevel(), return { level } per rest-api.md contract — Skipped: already implemented in T010 (src/routes/health.ts:42-58)

**Checkpoint**: Server starts with `npm run dev`, health endpoint responds, structured logs appear on stderr.

---

## Phase 3: User Story 5 — Manage Project Registry (Priority: P3 — moved early as foundation for US1/US2) 🎯 Foundation

**Goal**: Users can register, list, view details, and remove agent-framework projects.

**Independent Test**: Register a project, verify it appears in list with task summary, view detail page with full task list, remove it.

> **Note**: Although P3 priority, this is moved before US1/US2 because project CRUD is a prerequisite for sessions, monitoring, and task runs.

### Tests for User Story 5

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T012 [P] [US5] Write unit tests for task file parser in tests/unit/task-parser.test.ts — test checkbox parsing ([ ], [x], [?], [~]), phase detection, nested tasks, malformed input, missing file per research.md §5
- [x] T013 [P] [US5] Write contract tests for project REST endpoints in tests/contract/rest-api-projects.test.ts — GET /api/projects, POST /api/projects, GET /api/projects/:id, DELETE /api/projects/:id per rest-api.md
- [x] T014 [P] [US5] Write unit tests for project model in tests/unit/project.test.ts — CRUD operations, validation (dir exists, task file present, name non-empty, duplicate detection)

### Implementation for User Story 5

- [x] T015 [P] [US5] Implement task file parser in src/services/task-parser.ts — parse tasks.md to Task[] and TaskSummary, regex for status markers, phase headers, nesting depth, blocked reason extraction per data-model.md Task entity and research.md §5
- [x] T016 [US5] Implement project model in src/models/project.ts — CRUD for projects.json: list(), get(id), create({name, dir}), remove(id), taskFile defaults to tasks.md, auto-detect promptFile by scanning for spec-kit artifacts, validate dir exists and contains tasks.md per data-model.md Project entity
- [x] T017 [US5] Implement project REST routes in src/routes/projects.ts — GET /api/projects (list with taskSummary via task-parser), POST /api/projects (register with validation), GET /api/projects/:id (detail with full tasks[] and sessions[]), DELETE /api/projects/:id (unregister, reject if active session) per rest-api.md contracts
- [x] T018 [US5] Wire project routes into src/server.ts — mount /api/projects handlers

**Checkpoint**: Can register a project via `curl POST /api/projects`, list it, view details with parsed tasks, and delete it. All contract tests pass.

---

## Phase 4: User Story 1 — Start an Autonomous Task Run (Priority: P1) 🎯 MVP

**Goal**: Users start a task run; the system spawns a sandboxed agent, auto-loops through tasks, detects blocked/completed states, and persists all session state.

**Independent Test**: Register a project with unchecked tasks, start a task run, verify sandboxed process spawns, auto-loops on completion, pauses on [?], marks complete when all done.

### Tests for User Story 1

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T019 [P] [US1] Write unit tests for sandbox command builder in tests/unit/sandbox.test.ts — systemd-run command generation with ProtectHome/BindPaths/ProtectSystem/NoNewPrivileges, nix develop chaining, two-gate unsandboxed override (ALLOW_UNSANDBOXED env + allowUnsandboxed param), rejection when either gate missing, detection logic per research.md §1
- [x] T020 [P] [US1] Write unit tests for session logger in tests/unit/session-logger.test.ts — JSONL append, read full log, read from byte offset, sequence number monotonicity per research.md §2 and data-model.md Log Entry
- [x] T021 [P] [US1] Write unit tests for session model in tests/unit/session.test.ts — state machine transitions (running→waiting/completed/failed, waiting→running), meta.json persistence, concurrent session prevention per data-model.md Session entity
- [x] T022 [P] [US1] Write integration tests for process manager in tests/integration/process-manager.test.ts — spawn process, capture stdout/stderr, handle exit codes, kill process per plan.md key design §1-§2
- [x] T023 [P] [US1] Write integration tests for task-run auto-loop in tests/integration/task-loop.test.ts — re-parse after run, spawn next if unchecked remain, stop on [?], stop on all complete per plan.md key design §2

### Implementation for User Story 1

- [x] T024 [P] [US1] Implement sandbox command builder in src/services/sandbox.ts — build systemd-run --user --scope command array with ProtectHome=tmpfs, BindPaths=<project-dir>, ProtectSystem=strict, NoNewPrivileges=yes, chain nix develop <dir> --command claude, detect systemd-run availability at startup, implement two-gate unsandboxed override (ALLOW_UNSANDBOXED env var + allowUnsandboxed request param — both required), log visible warning when running unsandboxed, export isAvailable() and buildCommand(projectDir, args, allowUnsandboxed) per research.md §1
- [x] T025 [P] [US1] Implement JSONL session logger in src/services/session-logger.ts — createWriteStream (append mode), write({ts, stream, seq, content}), readAll(path), readFromOffset(path, byteOffset), track byte offsets, sequence number generation per research.md §2 and data-model.md Log Entry
- [x] T026 [US1] Implement session model in src/models/session.ts — create session dir under DATA_DIR/sessions/<id>/, write meta.json, state transitions with validation, list sessions by projectId, get by id, enforce one active session per project (FR-012) per data-model.md Session entity
- [x] T027 [US1] Implement process manager in src/services/process-manager.ts — spawn child process using sandbox.buildCommand(), pipe stdout/stderr to session-logger, handle process exit (exitCode), emit events for state changes, support kill(pid) for stopping sessions (FR-013) per plan.md key design §1
- [x] T028 [US1] Implement task-run auto-loop in src/services/process-manager.ts — on process exit: re-parse task file via task-parser, if unchecked tasks remain and no [?] → spawn new process, if [?] found → transition to waiting-for-input with question, if all done → mark completed, if crash → mark failed (FR-005, FR-006) per plan.md key design §2
- [x] T029 [US1] Implement session REST routes in src/routes/sessions.ts — POST /api/projects/:id/sessions (start session, validate no active session, check sandbox with two-gate override via allowUnsandboxed param), GET /api/projects/:id/sessions (list), GET /api/sessions/:id (detail), POST /api/sessions/:id/stop (kill process, mark failed), GET /api/sessions/:id/log (return JSONL as JSON array, support afterSeq param) per rest-api.md contracts
- [x] T029b [P] [US1] Write integration tests for session stop in tests/integration/session-stop.test.ts — start a session, stop it via POST /api/sessions/:id/stop, verify process killed, session marked failed, exit code set per rest-api.md contract (FR-013)
- [x] T030 [US1] Implement POST /api/sessions/:id/input in src/routes/sessions.ts — validate session is waiting-for-input, record answer, transition same session back to running state, re-spawn agent process with clarification context, continue appending to same output.jsonl per rest-api.md contract
- [x] T031 [US1] Wire session routes into src/server.ts — mount /api/sessions and /api/projects/:id/sessions handlers

**Checkpoint**: Can start a task run via API, see sandboxed process spawn, auto-loop continues on task completion, pauses on [?] with question, marks complete when done. All unit and integration tests pass.

---

## Phase 5: User Story 2 — Monitor Projects and Stream Output (Priority: P1)

**Goal**: Real-time dashboard with project status, live output streaming, and log replay on reconnect.

**Independent Test**: Start a task run, connect to WebSocket, verify live output appears, disconnect and reconnect, verify missed output is replayed then live streaming resumes.

### Tests for User Story 2

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T032 [P] [US2] Write contract tests for WebSocket session stream in tests/contract/websocket-api.test.ts — connect to /ws/sessions/:id, receive output messages with seq/ts/stream/content, receive state messages, receive sync after replay, verify lastSeq replay per websocket-api.md
- [x] T033 [P] [US2] Write integration tests for WebSocket streaming in tests/integration/websocket.test.ts — live output delivery, reconnect with lastSeq replays missed entries, backpressure handling (drop messages when buffer >64KB), heartbeat ping/pong per websocket-api.md

### Implementation for User Story 2

- [x] T034 [US2] Implement WebSocket upgrade handling in src/server.ts — parse URL path, route /ws/sessions/:id to session-stream handler, route /ws/dashboard to dashboard handler, reject unknown paths
- [x] T035 [US2] Implement session stream WebSocket handler in src/ws/session-stream.ts — on connect: parse lastSeq from query, replay from JSONL log (entries with seq > lastSeq), send sync message, add client to session broadcast set (Map<sessionId, Set<WebSocket>>), forward live output/state/progress/error messages, check bufferedAmount <64KB before send, heartbeat ping every 30s, remove on close per websocket-api.md
- [x] T036 [US2] Implement dashboard WebSocket handler in src/ws/dashboard.ts — maintain Set<WebSocket> of dashboard clients, broadcast project-update messages (projectId, activeSession, taskSummary) on session state changes, heartbeat ping every 30s per websocket-api.md
- [x] T037 [US2] Integrate WebSocket broadcasting into process-manager and session model — emit output events to session-stream clients, emit state/progress events to both session-stream and dashboard clients
- [x] T038 [US2] Implement PWA shell in src/client/index.html — HTML5 boilerplate, viewport meta for mobile, link manifest.json, register service worker, load built app.js bundle. Implement Preact app entry in src/client/app.tsx — render root component, mount router
- [x] T039 [P] [US2] Implement client-side hash router in src/client/lib/router.ts — listen to hashchange, route #/ to dashboard, #/projects/:id to project-detail, #/sessions/:id to session-view, #/new to new-project, #/settings to settings per plan.md PWA architecture
- [x] T040 [P] [US2] Implement REST API client wrapper in src/client/lib/api.ts — fetch wrapper for GET/POST/PUT/DELETE to /api/*, JSON request/response handling, error extraction
- [x] T041 [P] [US2] Implement WebSocket client with auto-reconnect in src/client/lib/ws.ts — connect to /ws/* paths, parse JSON messages, dispatch by type, track lastSeq for session streams, auto-reconnect with lastSeq on disconnect, exponential backoff per websocket-api.md
- [x] T042 [US2] Implement dashboard Preact component in src/client/components/dashboard.tsx — fetch GET /api/projects, render project cards with name, task progress (completed/total), status badge (idle/running/waiting), connect to /ws/dashboard for live updates, tap card to navigate to #/projects/:id
- [x] T043 [US2] Implement project detail Preact component in src/client/components/project-detail.tsx — fetch GET /api/projects/:id, render full task list with status indicators, show active session info, start/stop session buttons, session history list, navigate to #/sessions/:id
- [x] T044 [US2] Implement session view Preact component in src/client/components/session-view.tsx — connect to /ws/sessions/:id, render terminal-like output view (auto-scroll, distinguish stdout/stderr/system), show session state, display question when waiting-for-input

**Checkpoint**: Dashboard shows project cards with live status, tapping into a session shows streaming output, reconnect replays missed output. All WebSocket contract and integration tests pass.

---

## Phase 6: User Story 3 — Answer Blocked Tasks (Priority: P2)

**Goal**: Push notifications for blocked tasks, user can answer via the app, and the task run resumes.

**Independent Test**: Run a project with an ambiguous task, verify push notification arrives, answer through the app, confirm task run resumes.

### Tests for User Story 3

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T045 [P] [US3] Write unit tests for push notification service in tests/unit/push.test.ts — VAPID key loading, subscription storage, sendNotification payload format, handle expired subscriptions per research.md §4

### Implementation for User Story 3

- [x] T046 [US3] Implement push notification service in src/services/push.ts — load VAPID keys from config, store/retrieve subscriptions from push-subscriptions.json, sendNotification(subscription, {title, body, data}), handle 410 Gone (remove expired subscription) per research.md §4 and data-model.md Push Subscription
- [x] T047 [US3] Implement push REST routes in src/routes/push.ts — POST /api/push/subscribe (store subscription), GET /api/push/vapid-key (return public key) per rest-api.md contracts
- [x] T048 [US3] Wire push routes into src/server.ts — mount /api/push handlers
- [x] T049 [US3] Integrate push notifications into session lifecycle — send notification on: task blocked (FR-009, question + project name + task ID), session completed (project name + task summary), session failed (project name + error) per spec.md FR-009
- [x] T050 [US3] Implement service worker in src/client/sw.ts — handle push events (display notification with title, body, data from payload), handle notificationclick (open app to relevant session/project URL), basic offline caching of static assets (cache-first for app shell)
- [x] T051 [US3] Add push subscription UI to session-view Preact component in src/client/components/session-view.tsx — prompt for notification permission on first visit, subscribe to push via /api/push/subscribe, show subscription status
- [x] T052 [US3] Add input form to session-view Preact component in src/client/components/session-view.tsx — when session state is waiting-for-input, show the question text, text input field, submit button, POST /api/sessions/:id/input on submit, show session resuming (same session transitions back to running)

**Checkpoint**: Blocked tasks trigger push notifications, user can answer in-app, task run resumes automatically. Push unit tests pass.

---

## Phase 7: User Story 4 — Create a New Project via Spec-Kit Workflow (Priority: P2)

**Goal**: Users create a new project through the interactive spec-kit SDD workflow (specify → clarify → plan → tasks → analyze), with voice or text input. Each phase runs as a separate agent session. After planning is complete and the user approves, autonomous implementation is kicked off via `run-tasks.sh`.

**Independent Test**: Tap New Project, provide repo name and idea, go through spec-kit phases, verify artifacts generated, confirm project appears on dashboard and autonomous implementation starts.

### Tests for User Story 4

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T052b [P] [US4] Write unit tests for spec-kit workflow orchestrator in tests/unit/spec-kit.test.ts — phase sequencing (specify → clarify → plan → tasks → analyze), directory creation under AGENT_RUNNER_PROJECTS_DIR, phase completion detection (exit code 0 = advance, non-zero = stop and notify), analyze-remediate loop (re-run analyze after remediations until zero issues), project auto-registration after artifacts generated, run-tasks.sh launch after user approval per plan.md key design §6
- [x] T052c [P] [US4] Write contract tests for voice transcription endpoint in tests/contract/rest-api-voice.test.ts — POST /api/voice/transcribe with audio blob returns { text }, 503 when GOOGLE_STT_API_KEY not configured, 400 when no audio provided per rest-api.md contract

### Implementation for User Story 4

- [x] T053 [US4] Implement voice input module in src/client/lib/voice.ts — Web Speech API (webkitSpeechRecognition) for browser-native transcription, Google Speech-to-Text API mode (record audio via MediaRecorder, POST to /api/voice/transcribe), toggle between modes, visual listening indicator, return transcribed text per plan.md key design §5
- [x] T054 [US4] Add voice transcription endpoint POST /api/voice/transcribe in src/routes/voice.ts — receive audio blob, proxy to Google Speech-to-Text API using GOOGLE_STT_API_KEY, return { text } — return 503 if no API key configured per rest-api.md contract
- [x] T055 [US4] Implement new-project Preact component in src/client/components/new-project.tsx — form with repo name input, "Start Project" button, mic icon for voice input, spec-kit phase chat view (agent messages as text, user input via voice or typing), connect to /ws/sessions/:id for each phase's streaming, show current phase indicator (specify → clarify → plan → tasks → analyze), on workflow complete: navigate to dashboard
- [x] T056 [US4] Update session creation to support interview type — POST /api/projects/:id/sessions with type "interview", spawn claude in interview mode (bidirectional stdin/stdout), forward WebSocket input messages to process stdin per websocket-api.md client→server input message
- [x] T057 [US4] Implement spec-kit workflow orchestrator in src/services/spec-kit.ts — create project directory under AGENT_RUNNER_PROJECTS_DIR/<repo-name>/, run spec-kit phases (specify, clarify, plan, tasks, analyze) as sequential interactive agent sessions using the spec-kit SKILL.md prompts, each phase in a new agent session (own context window). After analyze: if issues found, interview user for remediations, apply them, and re-run analyze — loop until zero issues. Auto-register project after artifacts are generated, launch run-tasks.sh for autonomous implementation after user approval per plan.md key design §6
- [~] T057b [US4] Wire voice routes into src/server.ts — mount /api/voice handlers — Skipped: already wired in T054 (src/server.ts)

**Checkpoint**: Can create a project through spec-kit workflow with voice/text input, project appears on dashboard, autonomous implementation starts after approval.

---

## Phase 8: User Story 7 — Add Feature to Existing Project via Spec-Kit Workflow (Priority: P2)

**Goal**: Users add a new feature to an existing registered project by tapping "Add Feature" on the project detail screen, describing the feature via voice or text, and running the full spec-kit SDD workflow (specify → clarify → plan → tasks → analyze) as sequential interactive agent sessions against the existing project directory. The analyze phase loops until zero issues are found (capped at 5 iterations). After user approval, `run-tasks.sh` kicks off autonomous implementation.

**Independent Test**: Register a project, tap "Add Feature," describe a feature via text, verify each spec-kit phase runs as an interactive session, confirm analyze loops until clean, approve the plan, verify `run-tasks.sh` starts against the existing project directory.

**Dependencies**: Depends on US4 (reuses spec-kit workflow orchestrator and interactive session infrastructure) + US2 (needs session view and dashboard).

### Tests for User Story 7

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T070 [P] [US7] Write unit tests for add-feature workflow in tests/unit/spec-kit-add-feature.test.ts — verify orchestrator accepts existing project directory (no directory creation), passes project dir to each phase agent session, phase sequencing (specify → clarify → plan → tasks → analyze), analyze loop cap at 5 iterations with user notification on cap reached, run-tasks.sh launch against existing project dir after approval per spec.md US7 and plan.md key design §6
- [ ] T071 [P] [US7] Write contract tests for POST /api/projects/:id/add-feature in tests/contract/rest-api-add-feature.test.ts — returns session for specify phase, rejects when project has active session (409), rejects empty description (400), rejects unknown project (404) per rest-api.md contract

### Implementation for User Story 7

- [ ] T072 [US7] Extend spec-kit workflow orchestrator in src/services/spec-kit.ts — add startAddFeatureWorkflow(projectId, description) method that runs the same phase sequence as new-project but skips directory creation, uses existing project's dir from the project registry, passes feature description to the specify phase agent session per plan.md key design §6
- [ ] T073 [US7] Add REST endpoint POST /api/projects/:id/add-feature in src/routes/projects.ts — validate project exists, no active session, non-empty description, call spec-kit orchestrator startAddFeatureWorkflow(), return first session info with phase "specify" per rest-api.md contract
- [ ] T074 [US7] Implement add-feature Preact component in src/client/components/add-feature.tsx — form with feature description textarea, mic icon for voice input, reuse spec-kit phase chat view from new-project.tsx (extract shared component if not already extracted), show current phase indicator, connect to /ws/sessions/:id for streaming, display workflow phase transitions, navigate to project detail on completion
- [ ] T075 [US7] Add "Add Feature" button to project detail component in src/client/components/project-detail.tsx — show button when no active session, navigate to #/projects/:id/add-feature, pass project context to add-feature component
- [ ] T076 [US7] Emit phase transition WebSocket messages during add-feature workflow — send `phase` message type on each phase transition with workflow "add-feature", include iteration count for analyze loop, update dashboard `project-update` messages to include workflow info per websocket-api.md contract
- [ ] T077 [US7] Update client-side hash router in src/client/lib/router.ts — add route #/projects/:id/add-feature → add-feature component

**Checkpoint**: Can add a feature to an existing project through spec-kit workflow, analyze loops until clean (max 5), autonomous implementation starts after approval. Dashboard shows workflow phase progress.

---

## Phase 9: User Story 6 — Installable Mobile App (Priority: P3)

> **Note**: Renumbered from Phase 8 to Phase 9 to accommodate US7.

**Goal**: PWA installable on Android with home screen icon, system push notifications when backgrounded, offline log viewing.

**Independent Test**: Visit app URL on Android, install to home screen, verify icon, trigger blocked-task notification, confirm it arrives as system notification.

### Implementation for User Story 6

- [ ] T058 [P] [US6] Create web app manifest in public/manifest.json — name, short_name, start_url, display: standalone, theme_color, background_color, icons (192x192 and 512x512 PNG) per spec.md US6 acceptance criteria
- [ ] T059 [P] [US6] Create PWA icons — generate 192x192 and 512x512 PNG icons in public/icons/ (simple geometric design, can be placeholder)
- [ ] T060 [US6] Enhance service worker in src/client/sw.ts — cache static assets on install (app shell: index.html, app.js), cache-first strategy for cached assets, network-first for API calls, cache session log responses for offline viewing per spec.md US6 acceptance §3
- [ ] T061 [US6] Implement settings Preact component in src/client/components/settings.tsx — voice backend toggle (browser-native Web Speech API vs Google Speech-to-Text API, show availability based on /api/health cloudSttAvailable), log level display, push notification permission status, app version info

**Checkpoint**: App installable on Android, push notifications work when backgrounded, cached logs viewable offline.

---

## Phase 10: Crash Recovery & Polish

**Purpose**: Cross-cutting concerns, crash recovery, and final integration

- [ ] T062 Implement crash recovery service in src/services/recovery.ts — on server startup: scan sessions/ for meta.json with state "running" (re-spawn process from last task) or "waiting-for-input" (restore waiting state), log recovery actions per research.md §8 and spec.md FR-015
- [ ] T063 Write integration tests for crash recovery in tests/integration/recovery.test.ts — simulate crash (running session with meta.json), restart server, verify session resumes or restores waiting state
- [ ] T064 Integrate recovery service into src/server.ts startup — call recovery.resumeAll() after data dir init, before accepting connections
- [ ] T065 [P] Add CSS styling to src/client/index.html or src/client/style.css — mobile-first responsive layout, dark theme, terminal-like output styling, status badges, card components, touch-friendly tap targets
- [ ] T065b [P] Write unit tests for disk space monitor in tests/unit/disk-monitor.test.ts — mock fs.statfs, verify warning triggers when available space falls below DISK_WARN_THRESHOLD_MB (default 8192), verify no warning above threshold, verify 60-second polling interval, verify push notification and log emission on warning per spec.md FR-017
- [ ] T065c [P] Implement disk space monitoring in src/services/disk-monitor.ts — check available disk space in AGENT_RUNNER_DATA_DIR every 60 seconds, warn via push notification and server logs when below DISK_WARN_THRESHOLD_MB (default 8192 MB, user-configurable) per spec.md FR-017
- [ ] T066 [P] Add error handling middleware to src/server.ts — catch unhandled request errors, return JSON { error } with appropriate status codes, log errors with pino
- [ ] T067 Validate all REST API contracts end-to-end in tests/contract/rest-api.test.ts — run full contract test suite against running server, verify all 12 endpoints match rest-api.md
- [ ] T068 Validate all WebSocket contracts end-to-end in tests/contract/websocket-api.test.ts — run full contract test suite against running server, verify message formats match websocket-api.md
- [ ] T069 Run quickstart.md validation — follow quickstart.md steps on clean checkout, verify setup, build, dev, and basic usage flow work end-to-end

**Checkpoint**: Server recovers from crashes, all contracts verified, quickstart flow validated.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US5 Project Registry (Phase 3)**: Depends on Foundational — BLOCKS US1, US2 (they need projects)
- **US1 Task Runs (Phase 4)**: Depends on US5 (needs project CRUD)
- **US2 Monitoring (Phase 5)**: Depends on US1 (needs running sessions to stream)
- **US3 Blocked Tasks (Phase 6)**: Depends on US1 (needs waiting-for-input state) + US2 (needs session view)
- **US4 Spec-Kit Workflow (Phase 7)**: Depends on US5 (needs project registration) + US2 (needs session view)
- **US7 Add Feature (Phase 8)**: Depends on US4 (reuses spec-kit orchestrator) + US2 (needs session view + dashboard)
- **US6 Installable App (Phase 9)**: Depends on US2 (needs working PWA)
- **Polish (Phase 10)**: Depends on US1 + US2 at minimum

### User Story Dependencies

- **US5 (P3→moved early)**: Foundation for all stories — can start after Phase 2
- **US1 (P1)**: Can start after US5 — no dependencies on other stories
- **US2 (P1)**: Can start after US1 — needs sessions to exist for streaming
- **US3 (P2)**: Can start after US2 — needs session view for answer UI
- **US4 (P2)**: Can start after US5 + US2 — needs project registration + session view + spec-kit orchestration
- **US7 (P2)**: Can start after US4 — reuses spec-kit orchestrator + session infrastructure
- **US6 (P3)**: Can start after US2 — needs working PWA to make installable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models before services
- Services before routes/endpoints
- Server-side before client-side
- Core implementation before integration

### Parallel Opportunities

- Phase 1: T003, T004 can run in parallel
- Phase 2: T006, T007 can run in parallel; T010, T011 can run in parallel
- Phase 3: T012, T013, T014 can run in parallel (tests); T015 can parallel with T016
- Phase 4: T019-T023 can all run in parallel (tests); T024, T025 can run in parallel
- Phase 5: T032, T033 in parallel; T039, T040, T041 in parallel
- Phase 6: T045 independent
- Phase 7: T052b, T052c in parallel (tests)
- Phase 8: T070, T071 in parallel (tests)
- Phase 9: T058, T059 in parallel
- Phase 10: T065b, T065c in parallel (after T065b tests written)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for US1 together:
Task: "Write unit tests for sandbox command builder in tests/unit/sandbox.test.ts"
Task: "Write unit tests for session logger in tests/unit/session-logger.test.ts"
Task: "Write unit tests for session model in tests/unit/session.test.ts"
Task: "Write integration tests for process manager in tests/integration/process-manager.test.ts"
Task: "Write integration tests for task-run auto-loop in tests/integration/task-loop.test.ts"

# Launch parallel implementation tasks:
Task: "Implement sandbox command builder in src/services/sandbox.ts"
Task: "Implement JSONL session logger in src/services/session-logger.ts"
```

---

## Implementation Strategy

### MVP First (US5 + US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (config, logger, HTTP server)
3. Complete Phase 3: US5 — Project Registry (CRUD + task parsing)
4. Complete Phase 4: US1 — Autonomous Task Runs (sandbox, process manager, auto-loop)
5. **STOP and VALIDATE**: Register a real project, start a task run, verify end-to-end
6. At this point you have a functional CLI-driven agent runner

### Incremental Delivery

1. Setup + Foundational → Server boots, health endpoint works
2. Add US5 → Can register and manage projects via API
3. Add US1 → Can run tasks autonomously → **MVP!**
4. Add US2 → Can monitor via PWA dashboard and live streaming
5. Add US3 → Can answer blocked tasks via push notifications
6. Add US4 → Can create projects via spec-kit workflow with voice/text input
7. Add US7 → Can add features to existing projects via spec-kit workflow
8. Add US6 → Installable mobile app with offline support
9. Polish → Crash recovery, contract validation, quickstart check

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational + US5 together
2. Once US5 is done:
   - Developer A: US1 (task runs — critical path)
   - Developer B: US2 client-side (PWA shell, router, components — can mock API)
3. Once US1 is done:
   - Developer A: US3 (push + input flow)
   - Developer B: US2 server-side (WebSocket integration)
4. Then: US4, US6, Polish in any order

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- US5 is moved before US1/US2 despite being P3 because project CRUD is a prerequisite for all session operations
- Constitution principle VII (Test-First) means all test tasks are included
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
