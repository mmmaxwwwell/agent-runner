# Feature Specification: Agent Runner — Full System Specification

**Feature Branch**: `001-full-system-spec`
**Created**: 2026-03-24
**Status**: Draft
**Input**: Consolidated from specs 001–006 plus new requirement for full unit and end-to-end testing

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start an Autonomous Task Run (Priority: P1)

A user registers an existing agent-framework project and starts an autonomous task run. The system spawns a sandboxed agent process that works through the project's task list, completing tasks one by one. After each run, the system checks the task file: if unchecked tasks remain, it automatically starts another run. If a task is unclear, the agent marks it with a question and pauses for user input. When all tasks are done, the project is marked complete.

**Why this priority**: This is the core value proposition — running agent tasks autonomously without the user needing to babysit each invocation.

**Independent Test**: Register a project with a task list, start a run, verify tasks are completed sequentially with proper sandboxing.

**Acceptance Scenarios**:

1. **Given** a registered project with unchecked tasks, **When** the user starts a task run, **Then** a sandboxed agent process is spawned that works on the first unchecked task.
2. **Given** a running task-run session that completes a task, **When** unchecked tasks remain, **Then** the system automatically starts another agent run without user intervention.
3. **Given** a running task-run session, **When** the agent marks a task with a question (`[?]`), **Then** the session pauses and the user is notified that input is needed.
4. **Given** a running task-run session, **When** no unchecked tasks remain, **Then** the session is marked complete and the user is notified.
5. **Given** a task-run request, **When** the agent process is spawned, **Then** it is sandboxed so it can only access files within its own project directory.

---

### User Story 2 - Monitor Projects and Stream Output (Priority: P1)

A user opens the mobile app and sees a dashboard of all registered projects with their current status (idle, running, waiting for input) and task progress (e.g., "14/18 tasks"). Tapping a project shows the live output from the running agent session in a terminal-like view. If the user disconnects and reconnects, the app replays the session log from where they left off, then resumes live streaming.

**Why this priority**: Monitoring is essential for trust and debugging. Users need to see what agents are doing and verify progress.

**Independent Test**: Start a task run, open the dashboard, verify project status and progress, tap into a session to see live output, disconnect and reconnect to verify log replay.

**Acceptance Scenarios**:

1. **Given** one or more registered projects, **When** the user opens the dashboard, **Then** each project shows its name, task progress summary, and current state.
2. **Given** a project with a running session, **When** the user taps into the session view, **Then** they see the agent's output streamed in real time.
3. **Given** an active session the user was previously viewing, **When** the user disconnects and reconnects, **Then** missed output is replayed from the session log before resuming live streaming.
4. **Given** a completed session, **When** the user views it, **Then** the full session log is displayed for review.

---

### User Story 3 - Browse and Onboard Discovered Directories (Priority: P1)

A user opens the dashboard and sees every directory in their configured projects folder (`~/git` by default), regardless of registration status. Registered projects show task progress and session history. Unregistered directories appear separately with a clear visual distinction and an "Onboard" action. Clicking Onboard registers the project, ensures it has a working `flake.nix`, installs `specify` if needed, initializes spec-kit and git if missing, and launches an interactive Claude interview session.

**Why this priority**: Making invisible directories visible and one-click actionable is the entry point for all new work.

**Independent Test**: Place directories with varying states (registered, unregistered, with/without flake.nix) in the projects folder. Verify all appear on the dashboard. Click Onboard on an unregistered directory and verify the full initialization + interview flow.

**Acceptance Scenarios**:

1. **Given** the projects folder contains 5 directories and 2 are registered, **When** the user opens the dashboard, **Then** all 5 appear — 2 as registered projects with task progress, 3 as discovered directories with "Onboard" action.
2. **Given** a discovered directory with a `package.json` and no `flake.nix`, **When** the user clicks Onboard, **Then** a `flake.nix` is generated with correct stack packages, git is initialized, spec-kit is initialized, and a Claude interview session launches.
3. **Given** a discovered directory that already has `flake.nix`, `.specify/`, and `.git/`, **When** the user clicks Onboard, **Then** initialization is skipped and the Claude interview launches directly.
4. **Given** onboarding is in progress and the user's browser disconnects, **When** they reconnect, **Then** they see the full conversation history replayed from `output.jsonl`.
5. **Given** the projects folder contains hidden directories (e.g., `.config`), **When** the dashboard loads, **Then** hidden directories are not displayed.
6. **Given** a previously failed onboarding attempt, **When** the user views the project, **Then** they can see the current state and retry.

---

### User Story 4 - Create a New Project (Priority: P1)

A user clicks "New Project" on the dashboard, enters a project name, and the system creates the directory under `~/git`, generates a `flake.nix`, initializes git and spec-kit, and launches the Claude interview. Same end state as onboarding.

**Why this priority**: Equal to onboarding — the same flow for greenfield projects.

**Independent Test**: Enter a project name that doesn't exist. Verify directory creation, initialization, and Claude interview start.

**Acceptance Scenarios**:

1. **Given** no directory exists for the project name, **When** the user enters a name and clicks Go, **Then** the directory is created, `flake.nix` is generated, git and spec-kit are initialized, and the interview launches.
2. **Given** a project with that name already exists, **When** the user tries to create it, **Then** they see a 409 Conflict error.
3. **Given** the project name contains invalid characters, **When** the user submits, **Then** validation rejects it with a clear message.

---

### User Story 5 - Exhaustive Spec-Kit Interview (Priority: P1)

Once the interview session launches, the Claude agent conducts an exhaustive specification interview. It keeps probing until the spec is comprehensive — researching similar projects on the web, suggesting features, identifying gaps, and pushing for clarity on edge cases. The interview is a single long-running Claude session maintaining full conversational context.

**Why this priority**: The quality of the spec determines the quality of the implementation.

**Independent Test**: Start an interview. Verify the agent asks about core functionality, researches existing tools, suggests features, probes edge cases, and continues until satisfied. The spec should have no `[NEEDS CLARIFICATION]` tags.

**Acceptance Scenarios**:

1. **Given** a new project interview starts, **When** the user describes their idea, **Then** the agent researches similar projects and brings back informed questions.
2. **Given** the user has answered several questions, **When** gaps remain (error handling, deployment, auth), **Then** the agent continues asking rather than moving on.
3. **Given** the spec is comprehensive, **When** the agent is satisfied, **Then** it does NOT auto-advance to planning — it waits for the user to signal readiness.
4. **Given** the interview session crashes, **When** a new session starts, **Then** the agent recovers context from `spec.md` and `transcript.md`.

---

### User Story 6 - Answer Blocked Tasks (Priority: P2)

When an agent encounters an unclear task and marks it `[?]`, the user receives a push notification. They open the app, see the question, submit their answer, and the system resumes the task run.

**Why this priority**: Closes the human-in-the-loop feedback cycle that makes autonomous operation practical.

**Independent Test**: Run a project with an ambiguous task, verify notification, answer through the app, confirm resumption.

**Acceptance Scenarios**:

1. **Given** an agent marks a task `[?]`, **When** the session transitions to waiting-for-input, **Then** the user receives a push notification with the question.
2. **Given** a blocked task, **When** the user submits an answer, **Then** the same session resumes with the clarification.
3. **Given** multiple blocked tasks across projects, **When** the user views notifications, **Then** each identifies the project and task.

---

### User Story 7 - Add Feature to Existing Project (Priority: P2)

From the project detail screen, the user taps "Add Feature," describes the new feature, and the system runs the full spec-kit SDD workflow as sequential interactive agent sessions against the existing project directory.

**Why this priority**: Adding features to existing projects is the natural follow-on to project creation.

**Acceptance Scenarios**:

1. **Given** a registered project, **When** the user taps "Add Feature" and describes it, **Then** the spec-kit specify phase starts as an interactive session against the existing project directory.
2. **Given** a completed spec-kit phase, **When** artifacts are produced, **Then** the system automatically starts the next phase (specify → clarify → plan → tasks → analyze).
3. **Given** all planning phases complete, **When** the user approves, **Then** `run-tasks.sh` starts for autonomous implementation.

---

### User Story 8 - Real-Time Transcript and Planning Handoff (Priority: P2)

As the interview progresses, a server-side parser watches `output.jsonl` and extracts conversation turns into `transcript.md` in real-time. When the user signals readiness, the agent writes `interview-notes.md`, and the system transitions to separate sessions for plan → tasks → analyze.

**Why this priority**: The handoff ensures planning sessions have full context without needing the entire interview history.

**Acceptance Scenarios**:

1. **Given** an active interview, **When** the user sends a message and the agent responds, **Then** both turns appear in `transcript.md` within seconds.
2. **Given** the user says "I'm ready to plan", **When** the agent finishes, **Then** `interview-notes.md` is written and plan/tasks sessions launch sequentially.
3. **Given** the user has NOT signaled readiness, **When** the agent finishes a round of questions, **Then** it asks if the user wants to continue — it does NOT auto-advance.

---

### User Story 9 - Agent Git Push via SSH Agent Bridge (Priority: P2)

A sandboxed agent needs to push code to GitHub. It runs `git push`, which triggers SSH authentication. The server intercepts this via a custom Unix socket (`SSH_AUTH_SOCK`), parses the SSH agent protocol, and forwards the sign request over WebSocket to the connected client. The client displays what's being signed and the user authorizes by touching their Yubikey.

**Why this priority**: Enables git push from sandboxed agents using hardware key authentication where the key is on the client device.

**Acceptance Scenarios**:

1. **Given** a sandboxed agent runs `git push` with an SSH remote, **When** git requests SSH auth, **Then** the server intercepts via the custom SSH_AUTH_SOCK, parses the request, and sends a sign request over WebSocket.
2. **Given** the client receives a sign request, **When** it's displayed with operation details, **Then** the user can authorize the signing request or cancel.
3. **Given** the user authorizes signing, **When** the signed response reaches the server, **Then** git push completes.
4. **Given** no client is connected, **When** the agent attempts git push, **Then** the SSH agent returns failure immediately (no hang).
5. **Given** a key listing request (`SSH_AGENTC_REQUEST_IDENTITIES`), **When** the server receives it, **Then** it forwards to the client and returns the client's registered public key(s).
6. **Given** a non-whitelisted SSH agent message type, **When** the bridge receives it, **Then** it returns `SSH_AGENT_FAILURE` without forwarding.

---

### User Story 10 - Android App with Multi-Key Signing (Priority: P2)

The Android app loads the existing Preact PWA in a WebView and adds native signing support via multiple key types. Users can register Yubikey PIV keys (USB-C or NFC) and/or Android Keystore app keys. When the server sends an `ssh-agent-request`, the app displays a sign modal with a key picker, the user confirms, and the app signs via the selected backend and responds.

**Why this priority**: The native app enables hardware key authentication that browsers cannot provide, and app keys provide a software fallback for users without Yubikeys.

**Independent Test**: Install the app, configure server URL, register a key (Yubikey or app key), trigger a sign request from a task run, verify the modal appears with correct context and key selection, sign completes.

**Acceptance Scenarios**:

1. **Given** the app is installed and server URL configured, **When** the app opens, **Then** the dashboard loads in the WebView with all PWA functionality working.
2. **Given** a sign request arrives with `messageType: 13`, **When** displayed, **Then** a modal shows the operation context, a key picker (auto-selects if only one key matches), and signing completes on confirmation.
3. **Given** a key listing request (`messageType: 11`), **When** received, **Then** the native layer returns only currently-available keys (app keys always; Yubikey keys only when connected) automatically (no modal).
4. **Given** no signing keys are registered, **When** a sign request arrives, **Then** the app shows an error directing the user to key management settings.
5. **Given** multiple keys can fulfill a request, **When** the modal displays, **Then** the user can choose which key to use.
6. **Given** a Yubikey key is selected but the Yubikey is disconnected, **When** the modal displays, **Then** it shows "Connect Yubikey" and waits.
7. **Given** the Yubikey is disconnected mid-signing, **When** the app detects it, **Then** it sends `ssh-agent-cancel` and shows an error.
8. **Given** the Yubikey PIN is required, **When** the sign modal appears, **Then** a PIN input field is shown. After successful verification, subsequent requests skip the PIN prompt.
9. **Given** an app key is selected and biometric is enabled, **When** the user confirms signing, **Then** biometric authentication is required before the signature is produced.
10. **Given** the user opens Key Management, **When** they tap "Add App Key", **Then** an ECDSA P-256 keypair is generated in Android Keystore, the public key is displayed in SSH `authorized_keys` format with a copy button, and the key appears in the registry.
11. **Given** the user opens Key Management with a Yubikey connected, **When** they tap "Add Yubikey", **Then** the public key is read from PIV slot 9a, displayed, and added to the registry.
12. **Given** the key registry, **When** the user views it, **Then** each key shows name, type, fingerprint, and last used date. Keys can be renamed or removed.

---

### User Story 11 - Installable Mobile App with Push Notifications (Priority: P3)

The monitoring interface is installable as a standalone PWA on Android or accessed via the native Android app. Push notifications alert the user when tasks are blocked, projects complete, or sessions fail.

**Why this priority**: Installability and push notifications enhance the mobile experience but are polish features.

**Acceptance Scenarios**:

1. **Given** the PWA URL on Android, **When** the user installs it, **Then** it installs as a standalone app with home screen icon.
2. **Given** a task is blocked or project completes, **When** the event occurs, **Then** the user receives a system push notification.
3. **Given** previously viewed sessions, **When** the user opens the app offline, **Then** cached session logs are available.

---

### User Story 12 - Comprehensive Unit and End-to-End Testing (Priority: P1)

The entire application has full unit test coverage for all services, models, and utilities, plus end-to-end tests that validate complete user flows from the API/WebSocket layer through to session lifecycle, onboarding, task runs, and SSH agent bridging. Tests serve as the living specification of system behavior.

**Why this priority**: Without comprehensive testing, autonomous agents making code changes have no safety net. Tests are the primary feedback mechanism for correctness.

**Independent Test**: Run `npm test` and verify all unit and e2e tests pass, covering every service, model, route, WebSocket handler, and documented UI flow.

**Acceptance Scenarios**:

1. **Given** every service in `src/services/`, **When** unit tests run, **Then** each service has tests covering its public API, error paths, and edge cases.
2. **Given** every model in `src/models/`, **When** unit tests run, **Then** each model has tests covering CRUD operations, validation, and state transitions.
3. **Given** the UI flow documented in `UI_FLOW.md`, **When** end-to-end tests run, **Then** every flow has a corresponding test that exercises the full stack (API → service → model → filesystem).
4. **Given** the New Project workflow, **When** e2e tests run, **Then** the test exercises `POST /api/workflows/new-project`, verifies session creation, WebSocket streaming, and phase progression.
5. **Given** the session lifecycle, **When** e2e tests run, **Then** tests cover: start → run → complete, start → run → waiting-for-input → input → resume → complete, start → run → stop → failed, and concurrent session prevention.
6. **Given** the SSH agent bridge, **When** e2e tests run, **Then** tests cover: sign request flow (mock client), key listing, non-whitelisted message rejection, timeout handling, and socket cleanup.
7. **Given** the onboarding flow, **When** e2e tests run, **Then** tests cover: discovered directory → onboard → flake generation → git init → spec-kit init → interview launch, with idempotency verification.
8. **Given** the Add Feature workflow, **When** e2e tests run, **Then** tests cover: valid request → workflow starts, validation errors, phase transitions via WebSocket.
9. **Given** voice transcription, **When** e2e tests run, **Then** tests cover: valid audio → transcription, missing API key → 503, no audio → 400.
10. **Given** all tests pass, **When** a developer checks test files, **Then** each e2e test references the `UI_FLOW.md` section it validates (via comments like `// Validates UI_FLOW.md § New Project Flow`).

---

### Edge Cases

- What happens when the agent process crashes mid-task? Session is marked failed, user is notified, task is left unchecked for retry.
- What happens when the server process crashes or restarts? Running and waiting-for-input sessions are automatically resumed from persisted state.
- What happens when the project's task file is malformed or missing? Error reported to user, no run started.
- What happens when a user starts a run on a project with an active session? Concurrent sessions prevented, user informed.
- What happens when sandboxing is unavailable? Execution requires both `ALLOW_UNSANDBOXED` server env var AND `allowUnsandboxed` in the session start request. Visible warning in logs and output.
- What happens when the user's device loses connectivity during a live stream? Server continues logging; client replays on reconnect.
- What happens when voice recognition fails or is unsupported? Fall back to text input with notification.
- What happens when disk space is low? Monitor every 60 seconds, warn via push notification and logs when below `DISK_WARN_THRESHOLD_MB` (default 8192 MB).
- What happens when the WebSocket disconnects during a spec-kit phase? Client reconnects with lastSeq, replays missed output.
- What happens when `nix develop` fails due to flake syntax errors? Error surfaced clearly to user.
- What happens when `uv tool install specify-cli` fails? Error reported, onboarding re-triggerable (idempotent).
- What happens when the configured projects directory doesn't exist? Create it.
- What happens when a registered project's directory no longer exists on disk? Show a warning indicating the directory is missing.
- What happens when architecture detection returns an unexpected value? Default to `x86_64-linux` with a warning.
- What happens when the Yubikey is disconnected mid-signing? Client detects it, sends cancel, shows error.
- What happens when the WebSocket drops mid-signing? SSH agent socket returns failure after 60-second timeout.
- What happens when multiple sign requests arrive simultaneously? Queue them, show one modal at a time.
- What happens when the Yubikey PIN is blocked (3 failed attempts)? Show error that key is locked, cancel the sign request.
- What happens when the analyze phase keeps finding issues after multiple loops? Cap at 5 iterations, notify user, pause for manual intervention.

## Requirements *(mandatory)*

### Functional Requirements

#### Server Core

- **FR-001**: System MUST manage a registry of agent-framework projects, supporting registration, listing, detail view, and removal. Projects stored in `<dataDir>/projects.json`.
- **FR-002**: System MUST parse agent-framework markdown task files to extract task status, progress summaries, and blocked-task questions.
- **FR-003**: System MUST spawn sandboxed agent processes via `systemd-run --user` that can only access their own project directory. Unsandboxed execution requires two gates: `ALLOW_UNSANDBOXED` server env var AND `allowUnsandboxed` in the session start request. Unsandboxed execution MUST produce a visible warning.
- **FR-004**: System MUST support two session types: interactive interviews (bidirectional communication) and autonomous task runs (output-only with automatic looping).
- **FR-005**: System MUST automatically start a new task-run session when the previous run completes and unchecked tasks remain.
- **FR-006**: System MUST detect when an agent marks a task `[?]` and transition the session to waiting-for-input state.
- **FR-007**: System MUST log all agent output to persistent JSONL files (one JSON object per chunk: `seq` monotonically increasing, `ts` unix milliseconds, `stream` stdout/stderr/system, `content`) that survive restarts and disconnections. `seq` enables replay from any point.
- **FR-008**: System MUST support real-time output streaming to connected clients and log replay for clients that connect/reconnect mid-session.
- **FR-009**: System MUST send push notifications when a task is blocked, a project completes, or a session fails.
- **FR-010**: System MUST accept user input via text or voice transcription and deliver it to interview sessions. Voice transcription MUST support browser-native Web Speech API and Google Speech-to-Text API, switchable at runtime.
- **FR-011**: System MUST provide a mobile-installable PWA interface showing project status, task progress, live output, and accepting user input.
- **FR-012**: System MUST prevent concurrent sessions on the same project.
- **FR-013**: System MUST allow users to stop a running session at any time.
- **FR-014**: System MUST run agent processes via `nix develop <project-dir> --command` to inherit the project's Nix flake toolchain.
- **FR-015**: System MUST persist session state to disk and automatically resume running/waiting-for-input sessions on server startup.
- **FR-016**: System MUST emit structured JSON logs to stderr across all components using 6 log levels (trace, debug, info, warn, error, fatal), configurable at runtime.
- **FR-017**: System MUST monitor disk space in `AGENT_RUNNER_DATA_DIR` every 60 seconds and warn when below `DISK_WARN_THRESHOLD_MB` (default 8192 MB).

#### Voice Input

- **FR-018**: Voice module MUST use `continuous: true` on `SpeechRecognition` so recognition persists across natural pauses.
- **FR-019**: Voice module MUST set `interimResults: true` to show real-time partial transcription.
- **FR-020**: Mic button MUST function as a toggle — first click starts, second click stops.
- **FR-021**: Voice module MUST auto-stop after configurable silence timeout (default 5 seconds).

#### Project Discovery and Onboarding

- **FR-022**: `GET /api/projects` MUST return both registered projects (`type: "registered"`) and discovered directories (`type: "discovered"`) in a single response.
- **FR-023**: System MUST scan only top-level, non-hidden entries in the configured projects directory (`AGENT_RUNNER_PROJECTS_DIR`, default `~/git`). No recursive scanning.
- **FR-024**: For each discovered directory, detect whether it is a git repository, whether it has a `flake.nix`, and whether spec-kit artifacts exist.
- **FR-025**: Each discovered directory MUST have an "Onboard" action that initiates the onboarding workflow.
- **FR-026**: Onboard MUST register the project (persist to `projects.json` with status `"onboarding"`) before running any initialization, so it appears on the dashboard immediately.

#### Data Directory and Agent Framework

- **FR-027**: Default data directory MUST be `~/.local/share/agent-runner/`. `AGENT_RUNNER_DATA_DIR` env var overrides.
- **FR-028**: On startup, ensure agent-framework repository is cloned to `<dataDir>/agent-framework/`. If already cloned, `git pull` to update.
- **FR-029**: Before each session launch, `git pull` agent-framework to ensure skills are current.
- **FR-030**: Agent-framework directory MUST be mounted read-only into the sandbox via `BindReadOnlyPaths`.

#### Sandbox Enhancements

- **FR-031**: `buildCommand()` MUST accept session type (`'interview' | 'task-run'`) and apply appropriate Claude CLI flag presets.
- **FR-032**: Both presets MUST include `--output-format stream-json`, `--dangerously-skip-permissions`, `--model opus`.
- **FR-033**: Interview preset MUST support optional initial prompt via `-p` for the interview wrapper.
- **FR-034**: Sandbox MUST include `BindPaths` for `~/.cache/nix` and `~/.local/share/uv`.
- **FR-035**: Sandbox command MUST use `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code github:NixOS/nixpkgs/nixpkgs-unstable#uv --command nix develop {projectDir} --command claude ...` to inject tooling without polluting the project's flake.
- **FR-036**: System MUST detect host architecture and use it in generated `flake.nix` files.

#### Flake Generation

- **FR-037**: When a project has no `flake.nix`, generate one from templates based on detected stack (node, python, rust, go, generic).
- **FR-038**: Generated flakes MUST include only stack-specific packages — `claude-code` and `uv` injected via `nix shell` wrapper.
- **FR-039**: When a project already has a `flake.nix`, leave it untouched.

#### Spec-Kit Initialization and Interview

- **FR-040**: System MUST check for `specify` availability and install via `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git` if missing.
- **FR-041**: System MUST check for `.specify/` and run `specify init <name> --ai claude --script bash` if missing.
- **FR-042**: All initialization steps (flake, specify, git) MUST be idempotent.
- **FR-043**: Interview MUST be a single long-running Claude session with initial prompt referencing the interview wrapper from agent-framework skills.
- **FR-044**: Interview wrapper MUST instruct the agent to research similar projects, suggest features, probe edge cases, and loop specify → clarify until comprehensive.
- **FR-045**: Agent MUST NOT auto-advance to planning. Wait for explicit user confirmation.
- **FR-046**: On readiness, agent writes `interview-notes.md` to the spec directory.

#### Transcript Parser and Planning Handoff

- **FR-047**: Server-side process MUST watch `output.jsonl` and extract conversation turns into `transcript.md` in real-time.
- **FR-048**: Transcript parser MUST parse Claude CLI `stream-json` format, extracting assistant text as `## Agent` and user input as `## User`.
- **FR-049**: Tool calls MUST be summarized or omitted — only conversational text in transcript.
- **FR-050**: Transcript MUST be append-only so it's always current, even if session crashes.
- **FR-051**: After interview, system launches separate sessions for plan, tasks, and analyze phases, each reading `spec.md`, `interview-notes.md`, and `transcript.md`.

#### Unified Onboarding and New Project Flow

- **FR-052**: `POST /api/projects/onboard` and `POST /api/workflows/new-project` MUST be a unified flow handling both discovered directories and new projects.
- **FR-053**: Flow executes in order: register → create directory (if new) → generate flake (if missing) → git init (if missing) → install specify (if missing) → specify init (if missing) → launch interview. All commands run inside the sandbox.
- **FR-054**: Project status transitions: `"onboarding"` → `"active"` when interview completes and user signals readiness.

#### Git Initialization

- **FR-055**: System MUST check for `.git/` and run `git init` if missing.
- **FR-056**: PWA onboarding UI MUST offer optional remote setup: provide URL manually or create GitHub repo via `gh repo create`.

#### UI Changes

- **FR-057**: "New Project" dialog shows only a project name field and Go button — no description field.
- **FR-058**: After interview, project description in registry updated with agent-generated summary.

#### SSH Agent Bridge (Server-Side)

- **FR-059**: Server MUST create a Unix socket per session at `<dataDir>/sessions/<sessionId>/agent.sock`.
- **FR-060**: Sandbox MUST set `SSH_AUTH_SOCK` to the bridge socket and bind it via `BindPaths`.
- **FR-061**: Server MUST parse SSH agent protocol messages. Only `SSH_AGENTC_REQUEST_IDENTITIES` (type 11) and `SSH_AGENTC_SIGN_REQUEST` (type 13) are forwarded. All others return `SSH_AGENT_FAILURE` (type 5).
- **FR-062**: For sign requests, server MUST extract key blob and data fields, and derive remote host context from `git remote -v`.
- **FR-063**: SSH agent requests MUST be relayed via the existing WebSocket connection with unique request IDs for correlation.
- **FR-064**: If no client connected or client doesn't respond within 60 seconds, return `SSH_AGENT_FAILURE`.
- **FR-065**: WebSocket message types: `ssh-agent-request` (server → client), `ssh-agent-response` / `ssh-agent-cancel` (client → server). Binary data base64-encoded.
- **FR-066**: Bridge socket only created when project has an SSH git remote (detected via `git remote -v`).
- **FR-067**: Socket cleaned up when session ends. Stale sockets removed before creating new ones.

#### Android Client

- **FR-068**: Android app MUST load the agent-runner PWA in a WebView, connecting to the configured server URL. All existing PWA functionality works identically.
- **FR-069**: Native layer MUST open its own WebSocket connection to the session endpoint for SSH agent messages. WebView's web app remains unmodified.
- **FR-070**: App MUST detect Yubikey via USB-C (`android.hardware.usb`) and NFC (`android.nfc`).
- **FR-071**: App MUST use `yubikit-android` SDK (PIV module) for signing and key listing.
- **FR-072**: For sign requests (`messageType: 13`), match the requested key blob against `KeyRegistry`, route to the appropriate `SigningBackend`, display sign modal with key picker per FR-103, and return the signed result.
- **FR-073**: For key listing (`messageType: 11`), query `KeyRegistry` for currently-available keys per FR-100 and respond automatically (no modal).
- **FR-074**: PIV signing MUST detect key type at runtime. Initially only ECDSA P-256 supported — other types return clear error.
- **FR-075**: PIN management: prompt on first sign, cache in memory only (cleared on app destruction), never persisted. Show remaining retries on wrong PIN. Show locked error if PIN blocked.
- **FR-076**: Sign modal MUST remain visible until Yubikey touch completes, user cancels, or request times out. Multiple requests queued, shown one at a time.
- **FR-077**: Server URL persisted in SharedPreferences. First launch prompts for URL. Editable from settings.
- **FR-078**: Native layer monitors WebView URL hash changes to detect active session ID and manage its WebSocket connection.
- **FR-079**: Native layer exposes `@JavascriptInterface` for key status queries (connected Yubikeys, available app keys).

#### Multi-Key Support and Android Keystore

- **FR-097**: App MUST support multiple signing keys of mixed types (Yubikey PIV and Android Keystore) registered simultaneously.
- **FR-098**: App MUST persist a key registry (`keys.json` in app-private storage) containing key metadata: id, name, type, public key blob, SSH-format comment, fingerprint, creation date, last used date, and type-specific fields (pivSlot for Yubikey, keystoreAlias for app keys).
- **FR-099**: App MUST provide a key management UI: list registered keys (name, type, fingerprint, last used), add Yubikey (detect + read public key from PIV slot), generate app key (Android Keystore ECDSA P-256), remove keys, rename keys, export public key in `authorized_keys` format (copy to clipboard).
- **FR-100**: For `SSH_AGENTC_REQUEST_IDENTITIES` (type 11), app MUST return only keys that can sign right now: app keys are always available; Yubikey keys only when a Yubikey is connected. No caching of Yubikey public keys when hardware is absent.
- **FR-101**: Android Keystore signing backend MUST generate ECDSA P-256 keypairs, store them in hardware-backed Keystore when available, and produce SSH-format signatures.
- **FR-102**: Android Keystore signing MUST require biometric authentication (fingerprint/face) before each sign operation. Biometric requirement is an optional setting (enabled by default).
- **FR-103**: Sign modal MUST show a key picker when multiple keys can fulfill the request. Auto-select if only one key matches the requested key blob. User can always override the selection.
- **FR-104**: Signing architecture MUST use interface-based dependency injection: `SigningBackend` interface with `YubikeySigningBackend`, `KeystoreSigningBackend`, and `MockSigningBackend` (debug/test builds) implementations. `SignRequestHandler` routes sign requests by looking up the requested key blob in `KeyRegistry` and dispatching to the backend matching `KeyEntry.type` — no composite pattern needed. `MainActivity` (or `Application` subclass) creates all backend instances at startup; debug builds include `MockSigningBackend` alongside the others.
- **FR-105**: Debug build flavor MUST include `MockSigningBackend` that auto-signs with a test ECDSA P-256 keypair (generated idempotently) for development and testing without hardware.

#### Android Integration Testing

- **FR-106**: Android integration tests MUST run on a connected device via ADB using AndroidX Test + Espresso for UI assertions and DOM inspection of WebView content.
- **FR-107**: Integration test orchestration script (`npm run test:android:integration`) MUST: start the real agent-runner server with test fixtures, configure `adb reverse` port forwarding, install test APK, run instrumented tests, collect results to `test-logs/android-integration/`, tear down server.
- **FR-108**: Test fixtures MUST use template `projects.json` files in a temp data directory to initialize server state for different test scenarios.
- **FR-109**: Integration tests MUST include a local SSH test server (Node.js `ssh2` library) with a test ECDSA P-256 keypair (generated idempotently) and local bare git repo, enabling unattended end-to-end SSH agent bridge testing with `MockSigningBackend`.
- **FR-110**: Biometric prompts MUST be mocked in integration tests to auto-succeed, enabling unattended test execution.

#### UI Flow Documentation

- **FR-080**: `UI_FLOW.md` MUST exist in the project root with complete Mermaid flowchart covering all screens, routes, user actions, API calls, WebSocket connections, and state transitions.
- **FR-081**: `UI_FLOW.md` MUST include field validation tables, screen-by-screen detail sections, and API sequence diagrams.

#### Testing

- **FR-082**: Every service in `src/services/` MUST have unit tests covering its public API, error paths, and edge cases.
- **FR-083**: Every model in `src/models/` MUST have unit tests covering CRUD operations, validation, and state transitions.
- **FR-084**: Every route handler in `src/routes/` MUST have unit tests covering request validation, success responses, and error responses.
- **FR-085**: Every WebSocket handler in `src/ws/` MUST have unit tests covering connection lifecycle, message handling, and error recovery.
- **FR-086**: Every utility module in `src/lib/` MUST have unit tests covering all exported functions.
- **FR-087**: End-to-end tests MUST cover every flow documented in `UI_FLOW.md`, with each test referencing the specific section it validates via comments.
- **FR-088**: End-to-end tests MUST cover: New Project workflow (valid creation, validation errors, WebSocket streaming during phases).
- **FR-089**: End-to-end tests MUST cover: session lifecycle (start → complete, start → blocked → input → resume → complete, start → stop → failed, concurrent prevention).
- **FR-090**: End-to-end tests MUST cover: onboarding flow (discovered directory → onboard → init → interview, idempotency).
- **FR-091**: End-to-end tests MUST cover: Add Feature workflow (valid request, validation errors, phase transitions via WebSocket).
- **FR-092**: End-to-end tests MUST cover: SSH agent bridge (sign request with mock client, key listing, non-whitelisted message rejection, timeout, socket cleanup).
- **FR-093**: End-to-end tests MUST cover: voice transcription API (valid audio, missing API key → 503, no audio → 400).
- **FR-094**: End-to-end tests MUST cover: dashboard API (project list with task summaries, project detail with sessions, WebSocket dashboard updates on state change).
- **FR-095**: End-to-end tests MUST cover: crash recovery (server restart resumes running/waiting-for-input sessions).
- **FR-096**: All Node.js tests MUST run via `npm test` and pass in the Nix flake environment.

#### Test Log Infrastructure

- **FR-111**: All test runners (Node.js unit/integration/contract, Android instrumented) MUST output structured results to `test-logs/<type>/<timestamp>/`.
- **FR-112**: Passing tests MUST produce only a summary line (test name, duration). Failing tests MUST produce: test name, assertion details (expected vs actual), full stack trace, and any relevant context (logcat for Android, server logs for integration).
- **FR-113**: Each test run MUST produce a `summary.json` with pass/fail counts and list of failed test names. Failure detail files in `failures/` subdirectory.
- **FR-114**: Node.js test runner MUST use a custom reporter (Node native test runner custom reporter API) that writes the structured log format.
- **FR-115**: Android test runner MUST use a custom JUnit `RunListener` that writes the structured log format, including screenshots on UI test failure and filtered logcat on any failure.
- **FR-116**: Android integration tests MUST run via `npm run test:android:integration`. Node.js tests remain under `npm test`.

### Key Entities

- **Project**: A registered agent-framework project. `{ id, name, dir, status ("active" | "onboarding" | "error"), taskFile, promptFile, createdAt, description }`. Can have zero or one active sessions and many historical sessions.
- **Session**: An agent execution context tied to a project. `{ id, projectId, type ("interview" | "task-run"), state ("running" | "waiting-for-input" | "completed" | "failed"), startedAt, endedAt, pid, exitCode }`. Persistent output log. State persisted to disk for crash recovery.
- **Task**: An item parsed from a project's markdown task file. Has description, status (unchecked, checked, blocked with question), and ordering. Read from project files on demand, not stored by the system.
- **Session Log**: Persistent, append-only JSONL file. Each line: `{ seq, ts, stream ("stdout" | "stderr" | "system"), content }`. One per session. `seq` is monotonically increasing for replay.
- **Discovered Directory**: A top-level, non-hidden folder in the projects directory not present in `projects.json`.
- **Agent Framework**: Managed git clone at `<dataDir>/agent-framework/` containing skill files, interview wrapper, and run-tasks script.
- **Transcript**: `specs/<name>/transcript.md` — real-time conversation record from server-side parser.
- **Interview Notes**: `specs/<name>/interview-notes.md` — agent-written summary for planning handoff.
- **SSHAgentBridge**: Server-side service managing Unix socket creation, SSH agent protocol parsing, and WebSocket relay. One per active session with SSH remote.
- **SSHAgentRequest**: `{ requestId, messageType, context, data (base64) }`.
- **SSHAgentResponse**: `{ requestId, data (base64) }` or `{ requestId, cancelled: true }`.
- **KeyRegistry**: Persistent JSON file (`keys.json`) in Android app-private storage. Array of `KeyEntry` objects representing all registered signing keys.
- **KeyEntry**: `{ id (UUID), name, type ("yubikey-piv" | "android-keystore"), publicKey (base64 blob), publicKeyComment (SSH format), fingerprint (SHA256), pivSlot (yubikey only), keystoreAlias (app key only), createdAt, lastUsedAt }`.
- **SigningBackend**: Interface for signing operations with three implementations: `YubikeySigningBackend` (real PIV), `KeystoreSigningBackend` (Android Keystore with biometric), `MockSigningBackend` (debug/test builds).
- **SignRequestModal**: Native dialog overlaid on WebView for sign authorization. Shows operation context, key picker (auto-selects when possible, user can always override), PIN prompt for Yubikey, biometric prompt for app keys.
- **ServerConfig**: Persisted server URL in Android SharedPreferences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Autonomous task runs continue without user intervention until all tasks complete or input is needed — zero manual restarts between tasks.
- **SC-002**: Blocked-task notifications reach the user within 30 seconds.
- **SC-003**: After answering a blocked task, autonomous execution resumes within 30 seconds.
- **SC-004**: On disconnect/reconnect, 100% of missed output recovered through log replay.
- **SC-005**: Agent processes cannot read or write files outside their assigned project directory.
- **SC-006**: Voice input transcribed and delivered within 5 seconds.
- **SC-007**: A user can go from an empty directory to a running spec-kit interview in a single click.
- **SC-008**: Onboarding is fully idempotent — re-triggering completes remaining steps without duplication.
- **SC-009**: Interview agent asks at least 15 substantive questions for moderately complex projects, including web research.
- **SC-010**: Spec produced by interview has zero `[NEEDS CLARIFICATION]` tags.
- **SC-011**: Clean `transcript.md` generated in real-time with clear user/agent turn separation.
- **SC-012**: If interview crashes and restarts, agent recovers context from disk without user repeating themselves.
- **SC-013**: `nix develop` works inside sandbox for all supported stacks on both `x86_64-linux` and `aarch64-linux`.
- **SC-014**: A sandboxed agent can successfully `git push` to a GitHub SSH remote using Yubikey or app key authentication relayed through the WebSocket bridge.
- **SC-015**: Client displays human-readable description of what is being signed before authorization.
- **SC-016**: If no client connected or client cancels, git push fails gracefully (no hang, no crash).
- **SC-017**: Android app loads PWA dashboard with all features working identically to browser.
- **SC-018**: Key status indicators reflect connection state within 2 seconds (Yubikey hardware detection, app key availability).
- **SC-019**: App survives configuration changes (rotation, background/foreground) without losing state.
- **SC-020**: All unit tests pass, covering every service, model, route, WebSocket handler, and utility module.
- **SC-021**: All end-to-end tests pass, covering every flow documented in `UI_FLOW.md`.
- **SC-022**: `npm test` exits 0 with all tests passing in the Nix flake environment.

## Clarifications

### Consolidated from specs 001–006

- Session logs: JSONL format, one JSON object per output chunk with timestamp, stream type, content.
- Server bind address: configurable via env var, default localhost. Users configure `0.0.0.0` for LAN access.
- Voice transcription: browser-native Web Speech API and Google STT, switchable at runtime.
- Session resume: running/waiting-for-input sessions automatically resumed on server restart.
- Interview exhaustiveness: no cap at 5 questions — keep probing until comprehensive.
- SSH bridge: server-side only; client-side signing via Android app with Yubikey PIV or Android Keystore app keys.
- SSH protocol parser: hand-written (protocol is tiny — 2 message types, binary framing).
- Binary SSH data: base64-encoded inside JSON WebSocket messages.
- SSH auth: only enabled when project has SSH git remote configured.
- Android native WebSocket: separate connection from WebView, handles SSH agent messages natively.
- Yubikey SDK: `yubikit-android` official PIV module for APDU, USB/NFC, signing.
- Git remote setup: server-side PWA UI step before interview, not during interview.
- Pre-interview init commands: run inside systemd sandbox.
- Project status transition: `"onboarding"` → `"active"` when interview completes and user signals readiness.
- Dashboard discovery: refresh on page load only (manual browser refresh).
- Project registration schema: `{ name, dir, createdAt, status }` minimal at onboarding time.

## Assumptions

- Single-user system. No authentication, authorization, or multi-tenancy.
- Host has `systemd-run --user` for sandboxing. Degrades gracefully if unavailable.
- Projects use Nix flakes. Host has Nix installed.
- `claude` CLI is installed and accessible.
- Session logs retained indefinitely. No automatic cleanup.
- PWA accessed over local network or tunnel — no public internet deployment.
- Push notifications use standard Web Push protocol with self-hosted setup.
- Projects directory typically has fewer than 100 top-level directories.
- Android app targets API 26+ (Android 8.0 Oreo), compileSdk 34.

## Future Requirements (Out of Scope)

- **NixOS Module**: `services.agent-runner` NixOS module with nginx TLS termination, certificate path configuration, and port forwarding to the server on localhost or a Unix socket with restricted permissions. Server should support listening on a Unix socket (not just TCP) to enable this.
