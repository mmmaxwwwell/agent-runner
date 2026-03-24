# Feature Specification: Onboarding Overhaul

**Feature Branch**: `004-onboarding-overhaul`
**Created**: 2026-03-23
**Status**: Draft
**Input**: Unified onboarding flow — from create/discover to working Claude interview with exhaustive spec-kit SDD process

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Onboard a Discovered Directory (Priority: P1)

A user opens the dashboard and sees a discovered (unregistered) directory. They click "Onboard." The system registers the project, ensures it has a working `flake.nix`, installs `specify` if needed, initializes spec-kit if `.specify/` doesn't exist, initializes git if `.git/` doesn't exist, and launches an interactive Claude interview session. The user is immediately taken to the chat view where the Claude agent begins the spec-kit SDD interview — asking exhaustive questions, researching similar projects on the web, and probing for gaps until the spec is comprehensive.

**Why this priority**: This is the core value — one click from discovered directory to a working, interactive spec-kit interview. Every other story builds on this foundation.

**Independent Test**: Place a directory with a `package.json` (but no `flake.nix`, no `.specify/`, no `.git/`) in the projects folder. Click Onboard. Verify: flake.nix generated with correct stack packages, git initialized, specify installed, `.specify/` created, Claude interview session starts and asks the user about their project.

**Acceptance Scenarios**:

1. **Given** a discovered directory with a `package.json` and no `flake.nix`, **When** the user clicks Onboard, **Then** a `flake.nix` is generated with Node.js packages for the detected stack and correct system architecture, git is initialized, spec-kit is initialized, and a Claude interview session launches.
2. **Given** a discovered directory that already has a `flake.nix`, `.specify/`, and `.git/`, **When** the user clicks Onboard, **Then** the system skips all initialization steps and launches the Claude interview directly.
3. **Given** a discovered directory with a `Cargo.toml`, **When** the user clicks Onboard, **Then** the generated `flake.nix` includes Rust toolchain packages.
4. **Given** onboarding is in progress and the user's browser disconnects, **When** they reconnect, **Then** they see the full conversation history replayed from `output.jsonl`.

---

### User Story 2 - Create a New Project (Priority: P1)

A user clicks "New Project" on the dashboard. They enter a project name. The system creates the directory under `~/git`, generates a `flake.nix`, initializes git, installs `specify`, initializes spec-kit, and launches the Claude interview. Same end state as onboarding — the user is in a chat with an exhaustive spec-kit interviewer.

**Why this priority**: Equal to onboarding — this is the same flow for greenfield projects. The only difference is directory creation.

**Independent Test**: Enter a project name that doesn't exist. Verify the directory is created under `~/git`, all initialization steps run, and the Claude interview starts.

**Acceptance Scenarios**:

1. **Given** no directory exists for the project name, **When** the user enters a name and clicks Go, **Then** the directory is created under `projectsDir`, `flake.nix` is generated (generic stack), git is initialized, spec-kit is initialized, and the Claude interview launches.
2. **Given** a project with that name already exists (in registry or on disk), **When** the user tries to create it, **Then** they see an error and nothing is created.
3. **Given** the project name contains invalid characters, **When** the user submits, **Then** validation rejects it with a clear message.

---

### User Story 3 - Exhaustive Spec-Kit Interview (Priority: P1)

Once the interview session launches, the Claude agent conducts an exhaustive specification interview. It doesn't stop at 5 questions — it keeps probing until the spec is comprehensive. The agent researches similar projects on the web, suggests features the user hasn't thought of, identifies implementation gaps, and pushes for clarity on edge cases. The interview persists as a single long-running Claude session to maintain full conversational context.

**Why this priority**: The quality of the spec determines the quality of the implementation. A shallow 5-question interview produces specs with gaps that surface as follow-up features. An exhaustive interview front-loads that discovery.

**Independent Test**: Start an interview for a project idea (e.g., "a CLI tool for managing dotfiles"). Verify the agent: asks about core functionality, researches existing dotfile managers, suggests features based on that research, probes edge cases (symlinks, permissions, multi-machine sync), and continues asking until satisfied. The interview should produce a spec with no `[NEEDS CLARIFICATION]` tags.

**Acceptance Scenarios**:

1. **Given** a new project interview starts, **When** the user describes their idea, **Then** the agent researches similar projects on the web and brings back ideas and questions informed by that research.
2. **Given** the user has answered several questions, **When** the agent detects remaining gaps (e.g., error handling, deployment, auth), **Then** it continues asking rather than moving on.
3. **Given** the spec is comprehensive, **When** the agent is satisfied, **Then** it does NOT auto-advance to planning — it tells the user the spec looks complete and waits for the user to signal readiness.
4. **Given** the interview session crashes, **When** a new session starts, **Then** the agent reads the spec-in-progress and transcript from disk and picks up context.

---

### User Story 4 - Real-Time Transcript Generation (Priority: P2)

As the interview progresses, a server-side parser watches the session's `output.jsonl` and extracts user/agent conversation turns into a clean `specs/<name>/transcript.md` file in real-time. This transcript is readable by other agents in later phases (plan, tasks) and serves as a recovery document if the interview session crashes.

**Why this priority**: The transcript enables crash recovery and provides context for downstream phases without spending agent tokens. It's essential for the interview-notes handoff but not blocking for the core interview flow.

**Independent Test**: Start an interview, exchange several messages. Verify `transcript.md` is being written in real-time with clear `## User` and `## Agent` sections. Kill the Claude process, restart the interview — verify the agent can read the transcript to regain context.

**Acceptance Scenarios**:

1. **Given** an active interview session, **When** the user sends a message and the agent responds, **Then** both turns appear in `transcript.md` within seconds.
2. **Given** the agent uses tools (file reads, web searches), **When** the transcript is written, **Then** tool calls are summarized (not raw JSON) or omitted — only conversational text is included.
3. **Given** the interview completes, **When** the agent writes `interview-notes.md`, **Then** the transcript serves as the full record and `interview-notes.md` is a concise summary of key decisions, rejected alternatives, and user priorities.

---

### User Story 5 - Interview-to-Planning Handoff (Priority: P2)

When the user signals they're done with the interview, the agent writes `interview-notes.md` — a summary of key decisions, priorities, rejected alternatives, and things the user emphasized. The system then transitions to separate Claude sessions for plan → tasks → analyze, each reading `spec.md`, `interview-notes.md`, and `transcript.md` for context.

**Why this priority**: The handoff mechanism ensures planning sessions have the full context without needing 1M tokens of interview history. Independent of the interview quality itself.

**Independent Test**: Complete an interview, signal readiness. Verify `interview-notes.md` is written, then plan/tasks sessions launch sequentially, each producing their expected output files.

**Acceptance Scenarios**:

1. **Given** the user says "I'm ready to plan", **When** the agent finishes, **Then** `interview-notes.md` is written to the spec directory containing key decisions and priorities.
2. **Given** `interview-notes.md` exists, **When** the plan session starts, **Then** it reads `spec.md`, `interview-notes.md`, and `transcript.md` before generating `plan.md`.
3. **Given** planning completes successfully, **When** tasks are generated, **Then** they reference decisions captured in the interview notes.
4. **Given** the user has NOT signaled readiness, **When** the agent finishes a round of questions, **Then** it asks if the user wants to continue or move to planning — it does NOT auto-advance.

---

### User Story 6 - Git Initialization and Remote Setup (Priority: P2)

During onboarding, the system initializes a git repository if `.git/` doesn't exist. The user can optionally configure a remote — either by providing a URL manually or by having the system create a GitHub repo via `gh repo create`. Push functionality is deferred to a future feature (005-ssh-agent-bridge).

**Why this priority**: Git init is a prerequisite for meaningful work — commits, branches, history. Remote setup prepares for future push capability. But push itself isn't needed for the interview flow.

**Independent Test**: Onboard a directory without `.git/`. Verify git is initialized. Then configure a remote URL and verify `git remote -v` shows it.

**Acceptance Scenarios**:

1. **Given** a directory without `.git/`, **When** onboarding runs, **Then** `git init` is executed and the directory has a valid git repo.
2. **Given** a directory that already has `.git/`, **When** onboarding runs, **Then** git initialization is skipped.
3. **Given** the user provides a remote URL during onboarding, **When** the remote is configured, **Then** `git remote -v` shows the correct origin.
4. **Given** the user chooses to create a GitHub repo, **When** `gh repo create` runs, **Then** the new repo is created and set as origin.
5. **Given** `gh` is not available or not authenticated, **When** the user chooses GitHub repo creation, **Then** a clear error message is shown.

---

### User Story 7 - Simplified Create Project UI (Priority: P3)

The "New Project" dialog is simplified to a single field: project name. The description field is removed — the agent generates an accurate description once the scope is defined during the interview. The user enters a name and clicks Go.

**Why this priority**: UI polish. The current description field is premature — the user doesn't have a clear description before the interview. Lower priority because it's cosmetic.

**Independent Test**: Open the New Project dialog. Verify only a name field and Go button are present. Enter a name, click Go, verify the workflow starts.

**Acceptance Scenarios**:

1. **Given** the user opens the New Project dialog, **When** the dialog renders, **Then** only a project name field and a Go button are shown — no description field.
2. **Given** the interview produces a comprehensive spec, **When** the agent is satisfied, **Then** the project's description in the registry is updated with an agent-generated summary.

---

### Edge Cases

- What happens when `nix flake init` or flake generation fails (e.g., disk full, permissions)? The onboarding should report the error clearly and not leave the project in a half-initialized state.
- What happens when `uv tool install specify-cli` fails (e.g., network error, Python version mismatch)? The error should be reported and onboarding should be re-triggerable (idempotent).
- What happens when `specify init` fails? Same — report error, allow retry.
- What happens when the agent-framework git clone fails (network down, repo deleted)? The system should report that the framework is unavailable and cannot start sessions.
- What happens when `nix develop` fails because the flake has syntax errors (existing project with a broken flake)? The error should be surfaced clearly.
- What happens when the user re-onboards a project that is already registered? The system should detect the existing registration and resume from wherever initialization left off.
- What happens when `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code` fails because the channel doesn't have the package yet? Fall back gracefully with a clear error.
- What happens when the projects directory (`~/git`) doesn't exist? Create it.
- What happens when the Claude interview session is killed by OOM or signal? The spec-in-progress and transcript are on disk. Re-triggering onboard picks up from the current state.
- What happens when architecture detection returns an unexpected value? Default to `x86_64-linux` with a warning.

## Requirements *(mandatory)*

### Functional Requirements

#### Data Directory Migration

- **FR-001**: The default data directory MUST change from `~/.agent-runner/` to `~/.local/share/agent-runner/`. The `AGENT_RUNNER_DATA_DIR` env var continues to override this.
- **FR-002**: The system MUST NOT auto-migrate old data from `~/.agent-runner/`. Users are responsible for copying data if needed.

#### Agent Framework Management

- **FR-003**: On startup, the system MUST ensure the agent-framework repository is cloned to `<dataDir>/agent-framework/`. If already cloned, it MUST run `git pull` to update.
- **FR-004**: Before each session launch, the system MUST run `git pull` on the agent-framework clone to ensure skills are current.
- **FR-005**: The agent-framework repository URL MUST be hardcoded as `https://github.com/mmmaxwwwell/agent-framework` in the application config.
- **FR-006**: The agent-framework directory MUST be mounted into the sandbox via `BindReadOnlyPaths` so the agent can read skill files but not modify them.

#### Sandbox Enhancements

- **FR-007**: `buildCommand()` MUST accept a session type (`'interview' | 'task-run'`) and apply appropriate Claude CLI flag presets.
- **FR-008**: Both session type presets MUST include `--output-format stream-json`, `--dangerously-skip-permissions`, and `--model opus`.
- **FR-009**: Interview preset MUST support an optional initial prompt via `-p` for the interview wrapper.
- **FR-010**: Task-run preset MUST include `-p <prompt>` with the task prompt content.
- **FR-011**: The sandbox MUST include `BindPaths` for `~/.cache/nix` to allow nix store operations inside the sandbox.
- **FR-012**: The sandbox MUST include `BindPaths` for `~/.local/share/uv` to allow `uv` tool operations inside the sandbox.
- **FR-013**: The sandbox command MUST use `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code github:NixOS/nixpkgs/nixpkgs-unstable#uv --command nix develop {projectDir} --command claude ...` to inject agent-runner tooling without polluting the project's flake.
- **FR-014**: The system MUST detect the host architecture (e.g., `x86_64-linux`, `aarch64-linux`) and use it in generated `flake.nix` files instead of hardcoding `x86_64-linux`.

#### Flake Generation

- **FR-015**: When a project directory has no `flake.nix`, the system MUST generate one from templates based on detected stack (`node`, `python`, `rust`, `go`, `generic`).
- **FR-016**: Generated flakes MUST include only stack-specific packages — `claude-code` and `uv` are injected via `nix shell` wrapper, NOT added to the project flake.
- **FR-017**: Generated flakes MUST use the detected host architecture, not a hardcoded value.
- **FR-018**: When a project directory already has a `flake.nix`, the system MUST leave it untouched.

#### Spec-Kit Initialization

- **FR-019**: The system MUST check for `specify` availability by running `which specify` inside `nix shell ... --command`. If not installed, it MUST install via `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git`.
- **FR-020**: The system MUST check for `.specify/` directory in the project root. If missing, it MUST run `specify init <project-name> --ai claude --script bash`.
- **FR-021**: All initialization steps (flake, specify install, specify init, git init) MUST be idempotent — re-running onboarding on a fully-initialized project skips all steps and proceeds to launch the interview.

#### Git Initialization

- **FR-022**: The system MUST check for `.git/` in the project directory. If missing, it MUST run `git init`.
- **FR-023**: The PWA onboarding UI MUST offer the user two options for remote setup before the interview launches: (a) provide a remote URL manually, or (b) create a GitHub repo via `gh repo create`. This is a server-side UI step, not handled by the interview agent.
- **FR-024**: Remote setup MUST be optional — the user can skip it and configure later.
- **FR-025**: If the user chooses GitHub repo creation and `gh` is not available or not authenticated, the system MUST show a clear error.

#### Unified Onboarding Flow

- **FR-026**: The `POST /api/projects/onboard` and `POST /api/workflows/new-project` endpoints MUST be unified into a single flow that handles both discovered directories and new projects.
- **FR-027**: The onboarding flow MUST execute initialization steps in order: register project → create directory (if new) → generate flake (if missing) → git init (if missing) → install specify (if missing) → specify init (if missing) → launch interview. All steps that run commands (git init, specify install, specify init) MUST execute inside the systemd sandbox, same as session processes.
- **FR-028**: Each initialization step MUST check whether it's already done before executing. The entire flow MUST be idempotent.
- **FR-029**: The project MUST be registered with status `"onboarding"` before any initialization steps run, so it appears on the dashboard immediately.
- **FR-030**: If any initialization step fails, the project MUST remain registered with status `"error"` and the error MUST be surfaced to the user. Re-triggering onboard retries from the failed step.
- **FR-030a**: The project status MUST transition from `"onboarding"` to `"active"` when the interview completes and the user signals readiness (spec is written). Plan/tasks/analyze run on an `"active"` project.

#### Interview Session

- **FR-031**: The interview MUST be a single long-running Claude session that maintains full conversational context across the entire specify → clarify loop.
- **FR-032**: The interview session MUST be launched with an initial prompt (via `-p`) that references the interview wrapper from the agent-framework skills directory.
- **FR-033**: The interview wrapper prompt MUST instruct the agent to: use the spec-kit specify and clarify templates, research similar projects on the web, suggest features proactively, probe for edge cases and implementation gaps, and continue looping until the spec is comprehensive.
- **FR-034**: The interview wrapper prompt MUST live in the agent-framework at `.claude/skills/spec-kit/interview-wrapper.md` so it's reusable across projects.
- **FR-035**: The agent MUST NOT auto-advance to planning. When satisfied with the spec, it MUST ask the user if they're ready and wait for explicit confirmation.
- **FR-036**: When the user signals readiness, the agent MUST write `interview-notes.md` to the spec directory — a summary of key decisions, rejected alternatives, user priorities, and emphasized points.

#### Transcript Parser

- **FR-037**: A server-side process MUST watch the active session's `output.jsonl` and extract conversation turns into `specs/<name>/transcript.md` in real-time.
- **FR-038**: The transcript parser MUST parse Claude CLI `stream-json` output format, extracting `assistant` message text blocks as `## Agent` sections and user stdin input as `## User` sections.
- **FR-039**: Tool calls in the output MUST be summarized or omitted — only conversational text appears in the transcript.
- **FR-040**: The transcript MUST be written incrementally (append-only) so it's always up to date, even if the session crashes.

#### Planning Handoff

- **FR-041**: After the interview session completes, the system MUST launch separate Claude sessions for `plan`, `tasks`, and `analyze` phases.
- **FR-042**: Each post-interview session MUST read `spec.md`, `interview-notes.md`, and `transcript.md` for context alongside the spec-kit command templates.
- **FR-043**: The user MUST explicitly trigger the transition from interview to planning — no auto-advance.

#### UI Changes

- **FR-044**: The "New Project" dialog MUST show only a project name field and a Go button. The description field MUST be removed.
- **FR-045**: Once the interview produces a comprehensive spec, the system MUST update the project's description in the registry with an agent-generated summary.

### Key Entities

- **Project**: Registered project with `id`, `name`, `dir`, `status` (`active` | `onboarding` | `error`), `taskFile`, `promptFile`, `createdAt`, `description` (new — agent-generated after interview).
- **Session**: Interview or task-run process with `id`, `projectId`, `type`, `state`, `startedAt`, `endedAt`, `pid`, `exitCode`.
- **Agent Framework**: Managed git clone at `<dataDir>/agent-framework/` containing skill files, interview wrapper, and run-tasks script.
- **Transcript**: `specs/<name>/transcript.md` — real-time conversation record generated by server-side parser from `output.jsonl`.
- **Interview Notes**: `specs/<name>/interview-notes.md` — agent-written summary of key decisions for handoff to planning phases.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from an empty directory to a running spec-kit interview in a single click/action (Onboard or New Project).
- **SC-002**: The onboarding flow is fully idempotent — re-triggering on a partially initialized project completes remaining steps without duplicating work.
- **SC-003**: The interview agent asks at least 15 substantive questions (not 5) for a moderately complex project, including questions informed by web research of similar projects.
- **SC-004**: The spec produced by the interview has zero `[NEEDS CLARIFICATION]` tags.
- **SC-005**: A clean `transcript.md` is generated in real-time during the interview with clear user/agent turn separation.
- **SC-006**: If the interview session crashes and restarts, the agent recovers context from `spec.md` and `transcript.md` without the user repeating themselves.
- **SC-007**: The `nix develop` command works inside the sandbox for all supported stacks (node, python, rust, go, generic) on both `x86_64-linux` and `aarch64-linux`.
- **SC-008**: All initialization steps (flake, git, specify, spec-kit) complete without error for both new and existing directories.

## Clarifications

### Session 2026-03-23

- Q: Should git remote setup happen in the PWA UI (server-side, before interview) or during the Claude interview conversation? → A: Server-side PWA UI, before the interview launches.
- Q: Should pre-interview initialization commands (specify install, git init, etc.) run inside the systemd sandbox or unsandboxed? → A: Inside the sandbox, same as session processes.
- Q: When should project status transition from "onboarding" to "active"? → A: When the interview completes and user signals readiness (spec written). Plan/tasks/analyze run on an active project.
