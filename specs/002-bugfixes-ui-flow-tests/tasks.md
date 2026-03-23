# Tasks: Bugfixes, UI Flow Documentation, and Integration Tests

**Input**: Design documents from `/specs/002-bugfixes-ui-flow-tests/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Integration tests are explicitly requested (US4). Test tasks are included for US4 only — US1/US2/US3 do not request unit tests.

**Organization**: Tasks grouped by user story. US1 and US2 are independent P1 bug fixes. US3 depends on US1/US2 being complete (documents the fixed behavior). US4 depends on US3 (tests reference UI_FLOW.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify existing project structure and contracts before implementation

- [x] T001 Verify existing project structure matches plan.md — confirm src/routes/projects.ts, src/client/lib/voice.ts, src/services/spec-kit.ts, and src/server.ts exist and contain the expected exports
- [x] T002 Verify contract for POST /api/workflows/new-project in specs/002-bugfixes-ui-flow-tests/contracts/new-project-endpoint.md matches the existing add-feature handler pattern in src/routes/projects.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No new foundational infrastructure needed — this feature fixes bugs in existing code and adds docs/tests. All infrastructure (routing, WebSocket, voice module, spec-kit orchestrator) already exists.

**⚠️ CRITICAL**: Phase 1 verification must complete before proceeding.

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Fix "Not Found" Error on Start Project (Priority: P1) 🎯 MVP

**Goal**: Wire `POST /api/workflows/new-project` endpoint to the existing `startNewProjectWorkflow()` orchestrator so clicking "Start Project" no longer returns 404.

**Independent Test**: Navigate to `#/new`, fill in name "test-project" and description "A simple test", click "Start Project" — workflow begins, session created, specify phase starts.

### Implementation for User Story 1

- [x] T003 [US1] Add `POST /api/workflows/new-project` route handler in src/routes/projects.ts — validate name (non-empty, filesystem-safe `/^[a-zA-Z0-9._-]+$/`), validate description (non-empty), check duplicate name (projects.json + filesystem), return 400/409 errors per contract
- [x] T004 [US1] Wire the new handler to call `startNewProjectWorkflow()` from src/services/spec-kit.ts — follow the same SpecKitDeps pattern as the existing add-feature handler, create session, return `{ sessionId, projectId, phase: "specify", state: "running" }` with status 201
- [~] T005 [US1] Register the new route in src/server.ts apiRoutes map so the route dispatcher finds it — SKIP: already registered via mountProjectRoutes() called at server.ts:225; handler added in T003/T004
- [~] T006 [US1] Verify the client component src/client/components/new-project.tsx already calls the correct endpoint path — SKIP: confirmed client calls post('/workflows/new-project', ...) which api.ts prepends /api, matching the server route exactly

**Checkpoint**: "Start Project" button works end-to-end. Clicking it creates a project and starts the spec-kit workflow.

---

## Phase 4: User Story 2 — Fix Microphone Premature Disengagement (Priority: P1)

**Goal**: Fix voice module so mic captures continuous speech across pauses instead of cutting off after ~1 second.

**Independent Test**: Click mic button, speak for 10+ seconds with pauses, verify full transcription appears in the description field.

### Implementation for User Story 2

- [ ] T007 [P] [US2] Modify `transcribeBrowser()` in src/client/lib/voice.ts — set `recognition.continuous = true` and `recognition.interimResults = true`
- [ ] T008 [US2] Implement result accumulation in src/client/lib/voice.ts — iterate `event.results` from `event.resultIndex`, separate final vs interim results, accumulate confirmed text across multiple onresult events
- [ ] T009 [US2] Add silence timeout (5000ms default) in src/client/lib/voice.ts — reset timer on each onresult event, call `recognition.stop()` when timer fires, resolve with accumulated text
- [ ] T010 [US2] Implement toggle behavior in src/client/lib/voice.ts — first mic click starts listening, second click calls `recognition.stop()` and finalizes transcription
- [ ] T011 [US2] Expose interim results via callback in src/client/lib/voice.ts — add `onInterimResult` callback parameter so components can display real-time partial transcription

**Checkpoint**: Mic button captures multi-sentence dictation, shows interim results, stops on toggle or silence timeout.

---

## Phase 5: User Story 3 — Create Comprehensive UI Flow Document (Priority: P1)

**Goal**: Create `UI_FLOW.md` at project root documenting all screens, routes, API calls, WebSocket connections, state transitions, and field validations as Mermaid diagrams and tables.

**Independent Test**: Render `UI_FLOW.md` Mermaid diagrams, verify all 6 screens and 16+ endpoints are covered.

**Dependencies**: Depends on US1 and US2 being complete (documents the fixed behavior).

### Implementation for User Story 3

- [ ] T012 [US3] Read all client components in src/client/components/ and map every screen, route, user action, and navigation transition
- [ ] T013 [US3] Read all route handlers in src/routes/ and WebSocket handlers in src/ws/ to map every API endpoint and WebSocket path
- [ ] T014 [US3] Create UI_FLOW.md at project root with main Mermaid `flowchart TD` diagram covering all 6 screens (#/, #/new, #/projects/:id, #/sessions/:id, #/projects/:id/add-feature, #/settings), navigation transitions, API calls, WebSocket connections, and error paths
- [ ] T015 [US3] Add screen-by-screen detail sections to UI_FLOW.md — for each screen: route, on-load API calls, user actions, field validations, real-time updates, navigation out, error states
- [ ] T016 [US3] Add API sequence diagrams to UI_FLOW.md — Mermaid `sequenceDiagram` for: new project workflow, add feature workflow, session lifecycle, push notification subscription
- [ ] T017 [US3] Add field validation reference table to UI_FLOW.md — markdown table listing every input field with screen name, field name, required/optional, validation rules, error message

**Checkpoint**: `UI_FLOW.md` is the authoritative reference for all app behavior. Every screen, action, and endpoint is documented.

---

## Phase 6: User Story 4 — Integration Tests for All UI Flows (Priority: P2)

**Goal**: Write integration tests validating every flow in `UI_FLOW.md`. Each test references the specific section it validates.

**Independent Test**: Run `nix develop -c npm test` — all new integration tests pass.

**Dependencies**: Depends on US1 (fix), US2 (fix), US3 (UI_FLOW.md as test spec).

### Tests for User Story 4

- [ ] T018 [P] [US4] Create tests/integration/new-project-workflow.test.ts — test valid project creation (201), empty name (400), invalid name (400), empty description (400), duplicate name (409), verify response matches contract, reference UI_FLOW.md sections
- [ ] T019 [P] [US4] Create tests/integration/voice-api.test.ts — test transcription endpoint with valid audio, without API key (503), with no audio (400), reference UI_FLOW.md sections
- [ ] T020 [P] [US4] Create tests/integration/session-lifecycle.test.ts — test full lifecycle (create → run → complete), blocked flow (waiting-for-input → input → resume), stop flow (run → stop → failed), concurrent session prevention, reference UI_FLOW.md sections
- [ ] T021 [P] [US4] Create tests/integration/dashboard-api.test.ts — test project list with task summaries, project detail with sessions/tasks, WebSocket dashboard updates on session state change, reference UI_FLOW.md sections
- [ ] T022 [P] [US4] Create tests/integration/add-feature-workflow.test.ts — test valid add-feature (201), empty description (400), unknown project (404), active session conflict, phase transitions via WebSocket, reference UI_FLOW.md sections

**Checkpoint**: All integration tests pass. Every flow documented in UI_FLOW.md has a corresponding test.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [ ] T023 Run full test suite with `nix develop -c npm test` and fix any failures
- [ ] T024 Run `nix develop -c npm run build` and verify clean build
- [ ] T025 Run quickstart.md validation — verify all commands in specs/002-bugfixes-ui-flow-tests/quickstart.md work correctly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — no new infrastructure needed
- **US1 (Phase 3)**: Depends on Phase 1 verification — fix endpoint bug
- **US2 (Phase 4)**: Depends on Phase 1 verification — fix mic bug (independent of US1)
- **US3 (Phase 5)**: Depends on US1 + US2 completion — documents fixed behavior
- **US4 (Phase 6)**: Depends on US3 completion — tests reference UI_FLOW.md
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent — can start after Phase 1
- **US2 (P1)**: Independent — can start after Phase 1 (parallel with US1)
- **US3 (P1)**: Depends on US1 + US2 — documents the fixed application
- **US4 (P2)**: Depends on US3 — uses UI_FLOW.md as test specification

### Within Each User Story

- T003 → T004 → T005 → T006 (US1: validate → wire → register → verify client)
- T007 → T008 → T009 → T010 → T011 (US2: enable continuous → accumulate → timeout → toggle → interim callback)
- T012/T013 parallel → T014 → T015/T016/T017 parallel (US3: research → main diagram → detail sections)
- T018/T019/T020/T021/T022 all parallel (US4: all test files are independent)

### Parallel Opportunities

- **US1 and US2 are fully parallel** — they touch different files (routes vs voice module)
- **T007 is parallel with US1** — different file
- **T012 and T013 are parallel** — research reads, no writes
- **T015, T016, T017 are parallel** — writing different sections of same file but can be serialized if needed
- **T018–T022 are all parallel** — 5 independent test files

---

## Parallel Example: US1 + US2 Simultaneously

```bash
# These can run at the same time (different files):
Agent A: T003 → T004 → T005 → T006  (src/routes/projects.ts, src/server.ts)
Agent B: T007 → T008 → T009 → T010 → T011  (src/client/lib/voice.ts)
```

## Parallel Example: US4 Test Files

```bash
# All 5 test files can be written simultaneously:
Task: T018 tests/integration/new-project-workflow.test.ts
Task: T019 tests/integration/voice-api.test.ts
Task: T020 tests/integration/session-lifecycle.test.ts
Task: T021 tests/integration/dashboard-api.test.ts
Task: T022 tests/integration/add-feature-workflow.test.ts
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Verification
2. Complete Phase 3: US1 — Fix Start Project endpoint
3. **STOP and VALIDATE**: Click "Start Project" — no more 404
4. Deploy/demo if ready

### Incremental Delivery

1. US1 + US2 in parallel → Both P1 bugs fixed → Validate
2. US3 → UI_FLOW.md created → Review diagrams
3. US4 → All integration tests pass → Full confidence
4. Polish → Clean build, all tests green

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 and US2 are independent P1 fixes — implement in parallel for speed
- US3 requires reading the full codebase — task T012/T013 are research tasks
- US4 tests should mock only `child_process.spawn` per Constitution VII — use real HTTP server, real filesystem, real WebSocket
- Commit after each task or logical group
- All commands via `nix develop -c`
