# Tasks: Onboarding Overhaul

**Input**: Design documents from `/specs/004-onboarding-overhaul/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included per constitution requirement (VII. Test-First).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Data directory migration, config changes, agent framework management

- [x] T001 Update default data directory from `~/.agent-runner/` to `~/.local/share/agent-runner/` in src/lib/config.ts — change `resolveDataDir()` fallback, add `agentFrameworkDir` derived property to Config interface
- [x] T002 Add `AGENT_FRAMEWORK_REPO` constant (`https://github.com/mmmaxwwwell/agent-framework`) to src/lib/config.ts
- [x] T003 Add `description: string | null` field to Project interface in src/models/project.ts — update `createProject()` and `registerForOnboarding()` to accept and persist it, default to null

**Checkpoint**: Config and model foundations ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Sandbox enhancements, agent framework service, flake generator improvements — all user stories depend on these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational Phase

- [x] T004 [P] Write tests for architecture detection function (x64→x86_64-linux, arm64→aarch64-linux, fallback) in tests/unit/flake-generator.test.ts
- [x] T005 [P] Write tests for `buildCommand()` session-type presets in tests/unit/sandbox.test.ts — test new signature, verify both presets include `--output-format stream-json --dangerously-skip-permissions --model opus`, verify interview supports optional `-p`, verify task-run requires `-p`, verify `BindPaths` includes `~/.cache/nix` and `~/.local/share/uv`, verify `BindReadOnlyPaths` includes agentFrameworkDir, verify `nix shell` wrapper around `nix develop`
- [x] T006 [P] Write tests for agent framework clone/pull service in tests/unit/agent-framework.test.ts — test `ensureAgentFramework()` clones when missing, pulls when exists, handles git failures gracefully

### Implementation for Foundational Phase

- [x] T007 Add `detectArch()` function to src/services/flake-generator.ts — map `process.arch`+`process.platform` to nix system strings, update all flake templates to use detected arch instead of hardcoded `x86_64-linux`
- [x] T008 Refactor `buildCommand()` in src/services/sandbox.ts — new signature: `buildCommand(projectDir, sessionType, options)` where sessionType is `'interview' | 'task-run'`, options includes `allowUnsandboxed`, `prompt`, `agentFrameworkDir`, `sandboxAvailable`. Apply preset flags per type. Add `BindPaths` for `~/.cache/nix` and `~/.local/share/uv`. Add `BindReadOnlyPaths` for agentFrameworkDir. Wrap inner command with `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code github:NixOS/nixpkgs/nixpkgs-unstable#uv --command`
- [x] T009 Update all callers of `buildCommand()` to use new signature — src/routes/projects.ts, src/routes/sessions.ts, src/services/recovery.ts. Pass session type and options object instead of `claudeArgs[]` and `allowUnsandboxed` boolean
- [ ] T010 Create agent framework management service in src/services/agent-framework.ts — `ensureAgentFramework(dataDir)` clones repo if `<dataDir>/agent-framework/` missing, runs `git pull` if exists. Use `child_process.execFileSync` for git commands. Handle clone/pull failures with clear error messages
- [ ] T011 Call `ensureAgentFramework()` on server startup in src/server.ts — run after config load, before HTTP server starts. Log success/failure. Also wire `ensureAgentFramework()` to run before each session launch — add the call in the `runPhase()` callbacks in src/routes/projects.ts and the session creation path in src/routes/sessions.ts (FR-004 requires git pull before every session, not just startup)

**Checkpoint**: Foundation ready — sandbox produces correct commands, agent framework available, flakes use correct arch

---

## Phase 3: User Story 1 — Onboard a Discovered Directory (Priority: P1) 🎯 MVP

**Goal**: One click from discovered directory to running Claude interview session with full initialization pipeline

**Independent Test**: Place a directory with `package.json` (no flake.nix, no .specify/, no .git/) in projects folder. Click Onboard. Verify all initialization steps run and interview starts.

### Tests for User Story 1

- [ ] T012 [P] [US1] Write tests for onboarding pipeline in tests/unit/onboarding.test.ts — test idempotent step check/execute pattern, test each step's check function (flake exists → skip, .git exists → skip, .specify exists → skip, specify installed → skip), test error handling sets project status to `"error"`, test full pipeline with all steps already done skips everything
- [ ] T013 [P] [US1] Write integration test for unified onboard endpoint in tests/integration/onboard-api.test.ts — test POST /api/projects/onboard with discovered dir, test with newProject flag, test duplicate rejection (409), test idempotent re-onboard

### Implementation for User Story 1

- [ ] T014 [US1] Create onboarding pipeline service in src/services/onboarding.ts — define `OnboardingStep` interface with `check()`/`execute()`, implement step pipeline: register → create-directory → generate-flake → git-init → install-specify → specify-init → launch-interview. Each step checks before executing (idempotent). All command steps execute inside sandbox via `buildCommand()`. Broadcast step progress via WebSocket `onboarding-step` messages. On failure: set project status to `"error"`, surface error
- [ ] T015 [US1] Unify `POST /api/projects/onboard` endpoint in src/routes/projects.ts — accept both discovered dirs and new projects (via `newProject` flag). Remove `POST /api/workflows/new-project` endpoint. Call onboarding pipeline. Return projectId, sessionId, name, path, status. Handle git remote setup options (remoteUrl or createGithubRepo)
- [ ] T016 [US1] Add `onboarding-step` WebSocket message type to src/ws/dashboard.ts — broadcast `{ type: 'onboarding-step', projectId, step, status, error }` during onboarding initialization
- [ ] T017 [US1] Update project status transitions in src/models/project.ts — add `updateProjectStatus(dataDir, id, status)` function, support `"onboarding"` → `"error"` and `"error"` → `"onboarding"` transitions for retry

**Checkpoint**: Discovered directories can be onboarded with full initialization pipeline. All steps idempotent.

---

## Phase 4: User Story 2 — Create a New Project (Priority: P1)

**Goal**: Enter a project name, system creates directory and runs same onboarding pipeline as US1

**Independent Test**: Enter a new project name. Verify directory created under ~/git, all initialization runs, interview starts.

### Tests for User Story 2

- [ ] T018 [P] [US2] Write contract test for unified onboard endpoint with `newProject: true` in tests/contract/rest-api-projects.test.ts — verify 201 response shape, verify 409 on duplicate name, verify 400 on invalid name characters

### Implementation for User Story 2

- [ ] T019 [US2] Add new-project handling to onboarding pipeline in src/services/onboarding.ts — when `newProject: true`, validate name against `/^[a-zA-Z0-9._-]+$/`, create directory under `projectsDir`, then run same step pipeline. Check for name collision in registry and on disk
- [ ] T020 [US2] Create projects directory if missing — in the `create-directory` onboarding step, also ensure `cfg.projectsDir` (~/git) exists before creating the project subdirectory

**Checkpoint**: Both discovered dirs and new projects use unified onboarding flow

---

## Phase 5: User Story 3 — Exhaustive Spec-Kit Interview (Priority: P1)

**Goal**: Claude interview session that researches similar projects, asks exhaustive questions, and loops until spec is comprehensive

**Independent Test**: Start an interview, describe a project. Verify agent researches similar projects, asks >5 questions, and does NOT auto-advance to planning.

### Implementation for User Story 3

- [ ] T021 [US3] Verify interview wrapper prompt exists at agent-framework clone `<dataDir>/agent-framework/.claude/skills/spec-kit/interview-wrapper.md` — the file has already been written to the agent-framework repo. This task validates it's accessible from the sandbox via `BindReadOnlyPaths`, reads correctly, and contains the expected sections (approach, recovery, rules). If missing or outdated, update the agent-framework repo directly (external to this codebase)
- [ ] T022 [US3] Modify spec-kit workflow in src/services/spec-kit.ts — replace multi-session specify→clarify loop with single long-running interview session. Launch Claude with `-p` flag containing the interview wrapper prompt content (read from agent-framework dir). Keep plan→tasks→analyze as separate sessions that read spec.md, interview-notes.md, and transcript.md
- [ ] T023 [US3] Update `runPhase()` callback in src/routes/projects.ts — for the interview phase, pass the interview wrapper prompt to `buildCommand()` via the `prompt` option. For plan/tasks/analyze phases, pass their respective prompts

**Checkpoint**: Interview session is exhaustive and single-session. Agent researches, probes, and waits for user signal.

---

## Phase 6: User Story 4 — Real-Time Transcript Generation (Priority: P2)

**Goal**: Server-side parser writes clean transcript.md from output.jsonl in real-time

**Independent Test**: Start an interview, exchange messages. Verify transcript.md appears with `## User` and `## Agent` sections.

### Tests for User Story 4

- [ ] T024 [P] [US4] Write tests for transcript parser in tests/unit/transcript-parser.test.ts — test parsing Claude CLI stream-json format, test extraction of assistant text blocks as `## Agent`, test extraction of user stdin as `## User`, test tool calls are omitted or summarized, test incremental append (no overwrites), test handling of malformed JSON lines

### Implementation for User Story 4

- [ ] T025 [US4] Create transcript parser service in src/services/transcript-parser.ts — `TranscriptParser` class with `start()`/`stop()` methods. Poll output.jsonl for new entries (reuse byte-offset pattern from src/ws/session-stream.ts). Parse Claude CLI stream-json: extract `assistant` message text blocks → `## Agent` sections, extract user stdin input → `## User` sections. Omit tool_use blocks. Append incrementally to transcript.md. Handle session where spec directory path is provided at construction
- [ ] T026 [US4] Integrate transcript parser with interview session launch — in the onboarding pipeline (src/services/onboarding.ts) or spec-kit workflow (src/services/spec-kit.ts), start the transcript parser when the interview session begins, stop it when the session ends. The transcript path should be `specs/<feature-name>/transcript.md`

**Checkpoint**: Transcript is generated in real-time alongside interview sessions

---

## Phase 7: User Story 5 — Interview-to-Planning Handoff (Priority: P2)

**Goal**: Agent writes interview-notes.md, system transitions to separate plan/tasks/analyze sessions

**Independent Test**: Complete an interview, signal readiness. Verify interview-notes.md exists, plan session reads it.

### Implementation for User Story 5

- [ ] T027 [US5] Update spec-kit workflow to pass interview context to post-interview sessions in src/services/spec-kit.ts — plan/tasks/analyze sessions must receive prompts that instruct them to read `spec.md`, `interview-notes.md`, and `transcript.md` from the spec directory before executing their phase
- [ ] T028 [US5] Add explicit user trigger for planning transition — the interview agent writes interview-notes.md when user signals readiness. The spec-kit workflow detects interview session completion and waits for the user to explicitly start planning (e.g., via a UI action or the interview agent signaling completion). Transition project status from `"onboarding"` to `"active"` at this point
- [ ] T029 [US5] Update project description after interview in src/models/project.ts — add `updateProjectDescription(dataDir, id, description)` function. The spec-kit workflow calls this after interview completion with the agent-generated description from interview-notes.md

**Checkpoint**: Planning phases have full interview context. Project transitions to active.

---

## Phase 8: User Story 6 — Git Initialization and Remote Setup (Priority: P2)

**Goal**: Git repo initialized during onboarding, optional remote setup via PWA UI

**Independent Test**: Onboard a directory without .git/. Verify git initialized. Configure a remote URL, verify git remote -v.

### Implementation for User Story 6

- [ ] T030 [US6] Add git remote setup options to onboard endpoint in src/routes/projects.ts — accept `remoteUrl` and `createGithubRepo` fields in request body. Validate mutual exclusivity. Pass to onboarding pipeline
- [ ] T031 [US6] Implement git-remote onboarding step in src/services/onboarding.ts — if remoteUrl provided: `git remote add origin <url>`. If createGithubRepo: run `gh repo create <name> --private --source .` inside sandbox. Check: skip if origin already configured. Handle `gh` not found or not authenticated with clear error
- [ ] T032 [US6] Add git remote setup UI to onboarding flow in src/client/components/dashboard.tsx — when user clicks Onboard, show a modal/dialog with: skip, enter remote URL, or create GitHub repo. Pass selection to POST /api/projects/onboard

**Checkpoint**: Projects are git-initialized with optional remote configuration

---

## Phase 9: User Story 7 — Simplified Create Project UI (Priority: P3)

**Goal**: New Project dialog shows only name field and Go button

**Independent Test**: Open New Project dialog. Verify only name + Go. Enter name, verify workflow starts.

### Implementation for User Story 7

- [ ] T033 [US7] Simplify new-project form in src/client/components/new-project.tsx — remove description textarea and voice button for description. Keep only project name field and Go button. Update POST to use unified `/api/projects/onboard` with `newProject: true`. Include git remote setup options (same modal as onboard)
- [ ] T034 [US7] Update client API types in src/client/lib/api.ts — update `OnboardResponse` to include `sessionId`. Add types for unified onboard request. Remove `startNewProject()` function, replace with unified `onboardProject()` that handles both discovered and new projects

**Checkpoint**: UI is simplified. Both new project and onboard use same endpoint.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, consistency, test coverage

- [ ] T035 [P] Update existing tests that call `buildCommand()` with old signature in tests/unit/sandbox.test.ts, tests/integration/*.test.ts — fix all broken tests from the signature change in T008/T009
- [ ] T036 [P] Update existing onboard API tests to match unified endpoint in tests/integration/onboard-api.test.ts, tests/contract/rest-api-projects.test.ts
- [ ] T037 Remove deprecated `POST /api/workflows/new-project` references from tests/integration/new-project-workflow.test.ts and any other test files
- [ ] T038 Run quickstart.md validation — execute all manual sandbox test commands from specs/004-onboarding-overhaul/quickstart.md to verify nix shell composition and bind paths work correctly
- [ ] T039 Update UI_FLOW.md with new unified onboarding flow, removed new-project endpoint, and transcript/interview-notes file descriptions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 Onboard Discovered Dir (Phase 3)**: Depends on Foundational
- **US2 Create New Project (Phase 4)**: Depends on US1 (extends same pipeline)
- **US3 Exhaustive Interview (Phase 5)**: Depends on Foundational (can run in parallel with US1/US2 if sandbox is ready)
- **US4 Transcript Parser (Phase 6)**: Depends on Foundational (independent of US1-US3)
- **US5 Planning Handoff (Phase 7)**: Depends on US3 and US4
- **US6 Git Init + Remote (Phase 8)**: Depends on US1 (adds step to existing pipeline)
- **US7 Simplified UI (Phase 9)**: Depends on US1 and US2 (needs unified endpoint)
- **Polish (Phase 10)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — no story dependencies
- **US2 (P1)**: Depends on US1 — extends the onboarding pipeline
- **US3 (P1)**: Can start after Foundational — independent (interview wrapper + workflow changes)
- **US4 (P2)**: Can start after Foundational — independent (transcript parser)
- **US5 (P2)**: Depends on US3 + US4 — needs interview session and transcript
- **US6 (P2)**: Depends on US1 — adds git steps to pipeline
- **US7 (P3)**: Depends on US1 + US2 — needs unified endpoint

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models/types before services
- Services before routes/endpoints
- Core implementation before integration
- Story complete before dependent stories

### Parallel Opportunities

- T004, T005, T006 (foundational tests) can run in parallel
- T012, T013 (US1 tests) can run in parallel
- US3 and US4 can run in parallel after Foundational
- T035, T036 (polish test updates) can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tests together:
Task T004: "Write tests for architecture detection in tests/unit/flake-generator.test.ts"
Task T005: "Write tests for buildCommand() presets in tests/unit/sandbox.test.ts"
Task T006: "Write tests for agent framework service in tests/unit/agent-framework.test.ts"
```

## Parallel Example: After Foundational

```bash
# US1 and US3 can start in parallel:
Task T012: "Write tests for onboarding pipeline in tests/unit/onboarding.test.ts"
Task T021: "Create interview wrapper prompt at interview-wrapper.md"

# US4 can also start in parallel:
Task T024: "Write tests for transcript parser in tests/unit/transcript-parser.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 + 3)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T011)
3. Complete Phase 3: US1 — Onboard discovered dirs (T012-T017)
4. Complete Phase 4: US2 — Create new projects (T018-T020)
5. Complete Phase 5: US3 — Exhaustive interview (T021-T023)
6. **STOP and VALIDATE**: Test full onboarding flow end-to-end

### Incremental Delivery

1. Setup + Foundational → Sandbox and infrastructure ready
2. Add US1 → Can onboard discovered directories
3. Add US2 → Can also create new projects
4. Add US3 → Interview is exhaustive and research-driven
5. Add US4 → Transcript generated in real-time
6. Add US5 → Planning handoff works with full context
7. Add US6 → Git initialized with remote setup
8. Add US7 → Simplified UI
9. Polish → Tests updated, docs updated

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Constitution VII requires test-first for all new modules
- All sandbox commands tested experimentally — `BindPaths` for nix cache verified working
