# Feature Specification: Agent Runner Server and PWA System

**Feature Branch**: `001-agent-runner-server-pwa`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "A server + PWA system for running agent-framework projects autonomously"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start an Autonomous Task Run (Priority: P1)

A user registers an existing agent-framework project and starts an autonomous task run. The system spawns a sandboxed agent process that works through the project's task list, completing tasks one by one. After each run, the system checks the task file: if unchecked tasks remain, it automatically starts another run. If a task is unclear, the agent marks it with a question and pauses for user input. When all tasks are done, the project is marked complete.

**Why this priority**: This is the core value proposition — running agent tasks autonomously without the user needing to babysit each invocation. Without this, the system has no purpose.

**Independent Test**: Can be fully tested by registering a project with a task list, starting a run, and verifying that tasks are completed sequentially with proper sandboxing. Delivers autonomous task execution value immediately.

**Acceptance Scenarios**:

1. **Given** a registered project with unchecked tasks, **When** the user starts a task run, **Then** a sandboxed agent process is spawned that works on the first unchecked task.
2. **Given** a running task-run session that completes a task, **When** unchecked tasks remain in the task file, **Then** the system automatically starts another agent run without user intervention.
3. **Given** a running task-run session, **When** the agent marks a task with a question (`[?]`), **Then** the session pauses and the user is notified that input is needed.
4. **Given** a running task-run session, **When** no unchecked tasks remain, **Then** the session is marked complete and the user is notified.
5. **Given** a task-run request, **When** the agent process is spawned, **Then** it is sandboxed so it can only access files within its own project directory.

---

### User Story 2 - Monitor Projects and Stream Output (Priority: P1)

A user opens the mobile app and sees a dashboard of all registered projects with their current status (idle, running, waiting for input) and task progress (e.g., "14/18 tasks"). Tapping a project shows the live output from the running agent session in a terminal-like view. If the user disconnects and reconnects, the app replays the session log from where they left off, then resumes live streaming.

**Why this priority**: Monitoring is essential for trust and debugging. Users need to see what agents are doing and verify progress. Without visibility, autonomous execution is a black box.

**Independent Test**: Can be tested by starting a task run, opening the dashboard, verifying project status and progress are shown, tapping into a session to see live output, disconnecting, and reconnecting to verify log replay followed by live streaming.

**Acceptance Scenarios**:

1. **Given** one or more registered projects, **When** the user opens the dashboard, **Then** each project shows its name, task progress summary, and current state.
2. **Given** a project with a running session, **When** the user taps into the session view, **Then** they see the agent's output streamed in real time.
3. **Given** an active session the user was previously viewing, **When** the user disconnects and reconnects, **Then** the missed output is replayed from the session log before resuming live streaming.
4. **Given** a completed session, **When** the user views it, **Then** the full session log is displayed for review.

---

### User Story 3 - Answer Blocked Tasks (Priority: P2)

When an agent encounters an unclear task and marks it `[?]`, the user receives a notification on their phone. They open the app, see the question, type or speak their answer, and submit it. The system records the answer and resumes the task run with the clarification.

**Why this priority**: Without this, blocked tasks halt all progress. This closes the human-in-the-loop feedback cycle that makes autonomous operation practical.

**Independent Test**: Can be tested by running a project that has an intentionally ambiguous task, verifying the notification is received, answering the question through the app, and confirming the task run resumes.

**Acceptance Scenarios**:

1. **Given** a task-run session where the agent marks a task `[?]` with a question, **When** the session transitions to waiting-for-input, **Then** the user receives a push notification with the question.
2. **Given** a blocked task with a question displayed in the app, **When** the user submits an answer, **Then** the answer is recorded and the same session resumes with the clarification.
3. **Given** multiple blocked tasks across different projects, **When** the user views notifications, **Then** each notification identifies which project and task is blocked.

---

### User Story 4 - Create a New Project via Spec-Kit Workflow (Priority: P2)

A user starts a new project from their phone by tapping "New Project," providing a repo name, and describing their idea via voice or text. The system creates a project directory under `AGENT_RUNNER_PROJECTS_DIR/<repo-name>/` and runs the spec-kit SDD workflow interactively — each phase (specify, clarify, plan, tasks) is a separate agent session where the user participates via voice or text. After tasks are generated, the system runs the analyze phase and interviews the user to resolve any issues. Once remediations are applied, the system kicks off `run-tasks.sh` for autonomous implementation.

**Why this priority**: Voice-driven project creation is a key differentiator for mobile use, but the system is fully functional without it (users can register existing projects manually).

**Independent Test**: Can be tested by initiating a new project, speaking responses through the spec-kit phases, verifying each phase produces its artifacts, and confirming the project appears on the dashboard ready for autonomous implementation.

**Acceptance Scenarios**:

1. **Given** the user taps "New Project," **When** they provide a repo name and describe their idea, **Then** a project directory is created under `AGENT_RUNNER_PROJECTS_DIR/<repo-name>/` and the spec-kit specify phase begins.
2. **Given** an active spec-kit phase session, **When** the agent responds with a question, **Then** the response is displayed as text and the user can reply by voice or typing.
3. **Given** a completed spec-kit phase, **When** the phase produces its artifacts, **Then** the system automatically starts the next phase in a new agent session (specify → clarify → plan → tasks → analyze).
4. **Given** a completed analyze phase, **When** issues are found, **Then** the system interviews the user to resolve them and applies remediations before proceeding.
5. **Given** all planning phases are complete, **When** the user approves, **Then** the system kicks off `run-tasks.sh` for autonomous implementation and the project appears on the dashboard.
6. **Given** a voice input attempt, **When** the microphone is active, **Then** a visual indicator shows the system is listening and displays the transcribed text before sending.

---

### User Story 5 - Manage Project Registry (Priority: P3)

A user registers existing agent-framework projects by providing the project directory path and a display name. They can view all registered projects, see detailed task lists for each, and remove projects they no longer want to track.

**Why this priority**: Project management is foundational infrastructure but simple CRUD — it enables other stories but delivers limited standalone value.

**Independent Test**: Can be tested by registering a project, viewing it in the list with correct task summary, viewing its detail page with full task list, and removing it.

**Acceptance Scenarios**:

1. **Given** a valid agent-framework project directory, **When** the user registers it, **Then** it appears in the project list with its name and task summary.
2. **Given** a registered project, **When** the user views its details, **Then** the full task list from the project's markdown files is displayed.
3. **Given** a registered project with no active sessions, **When** the user removes it, **Then** it is unregistered and no longer appears in the dashboard.

---

### User Story 6 - Installable Mobile App (Priority: P3)

The monitoring interface is installable as a standalone app on Android. Once installed, it works like a native app with its own icon, push notifications for blocked tasks and completed projects, and offline access to previously viewed session logs.

**Why this priority**: Installability and push notifications enhance the mobile experience but are polish features — the system works in a browser without them.

**Independent Test**: Can be tested by installing the app on an Android device, verifying the home screen icon, triggering a blocked-task notification, and confirming it arrives as a system push notification.

**Acceptance Scenarios**:

1. **Given** the user visits the app URL on Android, **When** they choose to install it, **Then** it installs as a standalone app with its own home screen icon.
2. **Given** the installed app, **When** a task is blocked or a project completes, **Then** the user receives a system push notification even if the app is not in the foreground.
3. **Given** the installed app with previously viewed sessions, **When** the user opens the app without connectivity, **Then** they can view cached session logs.

---

## Clarifications

### Session 2026-03-22

- Q: When the server process crashes or is restarted, what should happen to sessions that were running? → A: Automatically resume interrupted sessions from where they left off.
- Q: How should voice transcription work? → A: Support both browser-native Web Speech API and Google Speech-to-Text API, switchable at runtime via a settings toggle or long-press on the mic icon. The server proxies audio to Google's API but does no local speech processing.
- Q: What format should session logs use for storage? → A: JSON Lines (JSONL) — one JSON object per output chunk with timestamp, stream type (stdout/stderr/system), and content.
- Q: Should the server bind to localhost or all interfaces? → A: Configurable via environment variable, defaulting to localhost (127.0.0.1).
- Q: Should the server emit its own operational logs, and at what level? → A: Full structured JSON logging with 5 levels (debug/info/warn/error/fatal) across all components — server lifecycle, session management, process spawning, sandboxing, streaming, push notifications, voice transcription, and task parsing. Configurable log level at runtime. Enterprise-grade debuggability.

### Edge Cases

- What happens when the agent process crashes mid-task? The session should be marked as failed, the user notified, and the task left unchecked so it can be retried.
- What happens when the server process crashes or restarts? See FR-015.
- What happens when the project's task file is malformed or missing? The system should report an error to the user rather than starting a run with no tasks.
- What happens when the user starts a run on a project that already has a running session? The system should prevent concurrent sessions on the same project and inform the user.
- What happens when the sandboxing mechanism is unavailable? The system refuses to start sessions unless the server was started with `ALLOW_UNSANDBOXED=true` AND the session start request includes `allowUnsandboxed: true`. Both gates are required. Unsandboxed execution produces a visible warning in server logs and session output.
- What happens when the user's device loses network connectivity during a live stream? The server continues running and logging; the client resumes from the log on reconnect.
- What happens when voice recognition fails or is unsupported by the browser? The system should fall back to text input and inform the user. If browser-native speech recognition is unavailable, the system should suggest switching to the Google Speech-to-Text backend.
- What happens when disk space is running low? The system should monitor available disk space and warn the user when it falls below a configurable threshold, rather than silently failing when logs can no longer be written.
- What happens when disk space runs out for session logs? See low disk space edge case above.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST manage a registry of agent-framework projects, supporting registration, listing, detail view, and removal.
- **FR-002**: System MUST parse agent-framework markdown task files to extract task status, progress summaries, and blocked-task questions.
- **FR-003**: System MUST spawn sandboxed agent processes that can only access their own project directory. Unsandboxed execution requires two gates: the `ALLOW_UNSANDBOXED` server env var AND `allowUnsandboxed` in the session start request. Unsandboxed execution MUST produce a visible warning in server logs and session output.
- **FR-004**: System MUST support two session types: interactive interviews (bidirectional communication) and autonomous task runs (output-only with automatic looping).
- **FR-005**: System MUST automatically start a new task-run session when the previous run completes and unchecked tasks remain.
- **FR-006**: System MUST detect when an agent marks a task `[?]` and transition the session to a waiting-for-input state.
- **FR-007**: System MUST log all agent process output to persistent JSONL files (one JSON object per chunk, each containing a timestamp, stream type — stdout/stderr/system — and content) that survive process restarts and client disconnections.
- **FR-008**: System MUST support real-time output streaming to connected clients and log replay for clients that connect or reconnect mid-session.
- **FR-009**: System MUST send push notifications when a task is blocked, a project completes, or a session fails.
- **FR-010**: System MUST accept user input via text or voice transcription and deliver it to interview sessions. Voice transcription MUST support two backends — browser-native Web Speech API and Google Speech-to-Text API — switchable at runtime via a settings page or by long-pressing the microphone icon. The server proxies audio to Google's API but does no local speech processing.
- **FR-011**: System MUST provide a mobile-installable interface that shows project status, task progress, live output, and accepts user input.
- **FR-012**: System MUST prevent concurrent sessions on the same project.
- **FR-013**: System MUST allow users to stop a running session at any time.
- **FR-014**: System MUST run agent processes via `nix develop <project-dir> --command` to inherit the project's Nix flake toolchain.
- **FR-015**: System MUST persist session state to disk and, on server startup, automatically resume any sessions that were running or waiting-for-input when the server last stopped.
- **FR-016**: System MUST emit structured JSON logs to stderr across all components (server lifecycle, session management, process spawning, sandboxing, streaming, push notifications, voice transcription, task parsing) using 5 log levels (debug, info, warn, error, fatal). The active log level MUST be configurable at runtime via environment variable or API.
- **FR-017**: System MUST monitor available disk space and warn the user (via push notification and server logs) when it falls below a threshold, before session logs fail to write.
- **FR-018**: System MUST orchestrate the spec-kit SDD workflow for new projects — running specify, clarify, plan, tasks, and analyze phases as separate interactive agent sessions, then launching `run-tasks.sh` for autonomous implementation after user approval.

### Key Entities

- **Project**: A registered agent-framework project. Has a display name, directory path, and references to its task and prompt files. A project can have zero or one active sessions and many historical sessions.
- **Session**: An agent execution context tied to a project. Has a type (interview or task-run), a lifecycle state (running, waiting-for-input, completed, failed), a persistent output log, and belongs to exactly one project. When a session is waiting-for-input and the user provides an answer, the same session transitions back to running (re-spawning the agent process) — it does not create a new session. Session state is persisted to disk so that running and waiting-for-input sessions can be automatically resumed after a server restart. Sessions are immutable once completed — they are historical records.
- **Task**: An item parsed from a project's markdown task file. Has a description, status (unchecked, checked, blocked with question), and ordering. Tasks are not stored by the system — they are read from the project's files on demand.
- **Session Log**: A persistent, append-only JSONL file recording all output from a session. Each line is a JSON object with a timestamp, stream type (stdout/stderr/system), and content. Used for live streaming, replay on reconnect, and historical review. Each session has exactly one log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Autonomous task runs continue without user intervention until all tasks are complete or a task requires input — zero manual restarts needed between tasks.
- **SC-002**: When a task is blocked with a question, the user receives a notification within 30 seconds.
- **SC-003**: After answering a blocked task, the system resumes autonomous execution within 30 seconds.
- **SC-004**: When a client disconnects and reconnects, 100% of missed output is recovered through log replay.
- **SC-005**: Agent processes cannot read or write files outside their assigned project directory.
- **SC-006**: Voice input is transcribed and delivered to the agent within 5 seconds of the user finishing speaking.
- **SC-007**: A new project can be created through the spec-kit workflow, with autonomous implementation kicked off after user approval.

## Assumptions

- The system is single-user (one operator managing their own projects). No authentication, authorization, or multi-tenancy is needed.
- The host system has `systemd-run --user` available for sandboxing. If unavailable, the system degrades gracefully with a warning.
- Projects use Nix flakes for their development environment. The host has Nix installed.
- The `claude` CLI is installed and accessible on the host system.
- Session logs are retained indefinitely. No automatic cleanup or rotation is implemented unless explicitly requested.
- The PWA is accessed over the local network or via a tunnel — no public internet deployment is assumed.
- The server bind address is configurable via environment variable, defaulting to localhost (127.0.0.1). Users must explicitly configure 0.0.0.0 or a specific interface for LAN/mobile access.
- Push notifications use the standard Web Push protocol with a self-hosted setup.
