# Tasks: Project Directory Discovery & Onboarding

**Input**: Design documents from `/specs/003-project-discovery/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included — the spec references test files and the constitution mandates test-first (Article VII).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New service file and type scaffolding shared across all stories

- [x] T001 Add `status` field to Project interface and default it for existing projects in src/models/project.ts
- [x] T002 Add `DiscoveredDirectory` interface to src/models/project.ts per data-model.md
- [x] T003 Create discovery service scaffold with `scanProjectsDir()`, `detectGitRepo()`, `detectSpecKitArtifacts()` stubs in src/services/discovery.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core model functions that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement `registerForOnboarding(dataDir, { name, dir })` in src/models/project.ts — creates project with `status: "onboarding"`, no tasks.md requirement
- [x] T005 Implement `updateProjectStatus(dataDir, id, status)` in src/models/project.ts
- [x] T006 [P] Write unit tests for `status` field defaulting, `registerForOnboarding()`, and `updateProjectStatus()` in tests/unit/project.test.ts

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Browse All Projects in Workspace (Priority: P1) 🎯 MVP

**Goal**: Dashboard shows every directory in the projects folder — registered projects with task progress, unregistered directories with visual distinction and "Onboard" action.

**Independent Test**: Place several directories in projectsDir (some registered, some not) and verify `GET /api/projects` returns both `registered` and `discovered` arrays correctly. Dashboard renders both sections.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [P] [US1] Write unit tests for `scanProjectsDir()` in tests/unit/discovery.test.ts — cover: returns discovered dirs, skips hidden dirs, skips registered dirs, handles empty dir, handles missing projectsDir, handles permission errors, handles symlinks
- [x] T008 [P] [US1] Write unit tests for `detectGitRepo()` and `detectSpecKitArtifacts()` in tests/unit/discovery.test.ts
- [x] T009 [P] [US1] Write integration tests for extended `GET /api/projects` in tests/integration/discovery-api.test.ts — verify `{ registered, discovered, discoveryError }` response shape per contracts/discovery-api.md

### Implementation for User Story 1

- [x] T010 [US1] Implement `detectGitRepo(dirPath)` in src/services/discovery.ts — check for `.git` file or directory
- [x] T011 [US1] Implement `detectSpecKitArtifacts(dirPath)` in src/services/discovery.ts — scan specs/*/ subdirectories for spec.md, plan.md, tasks.md
- [x] T012 [US1] Implement `scanProjectsDir(projectsDir, registeredPaths)` in src/services/discovery.ts — read top-level entries, filter hidden/non-dirs, skip registered, resolve symlinks, call detectGitRepo + detectSpecKitArtifacts, return DiscoveredDirectory[]
- [x] T013 [US1] Modify `GET /api/projects` handler in src/routes/projects.ts — change response shape from flat array to `{ registered, discovered, discoveryError }` per contract, add `type: "registered"`, `status`, and `dirMissing` fields to registered entries, call scanProjectsDir for discovered entries
- [x] T014 [US1] Update dashboard component in src/client/components/dashboard.tsx — parse new response shape, render registered projects section (existing cards + status badge for onboarding/error), render discovered directories section with name, and "Onboard" placeholder button
- [~] T015 [US1] Update client API types in src/client/lib/api.ts to match new `GET /api/projects` response shape — SKIPPED: types already match the contract (RegisteredProject, DiscoveredDirectory, ProjectsResponse, OnboardRequest, OnboardResponse all present and correct)
- [x] T016 [US1] Handle empty states in src/client/components/dashboard.tsx — no projects at all, only registered, only discovered, discoveryError message

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 — Onboard a Discovered Directory (Priority: P2)

**Goal**: User clicks "Onboard" on a discovered directory, system immediately registers it and starts the new-project workflow. Project appears on dashboard right away.

**Independent Test**: Call `POST /api/projects/onboard` with a valid directory path, verify project is immediately persisted to projects.json with `status: "onboarding"`, and the response includes `projectId`.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T017 [P] [US2] Write integration tests for `POST /api/projects/onboard` in tests/integration/onboard-api.test.ts — cover: successful onboard returns 201, missing path returns 400, non-directory returns 400, already registered returns 409, project persists in projects.json

### Implementation for User Story 2

- [ ] T018 [US2] Add `POST /api/projects/onboard` route in src/routes/projects.ts — validate path exists + is directory + not already registered, call `registerForOnboarding()`, return 201 with `{ projectId, name, path, status }` per contract
- [ ] T019 [US2] Wire "Onboard" button in src/client/components/dashboard.tsx — call `POST /api/projects/onboard`, on success move directory from discovered to registered section, handle errors (show message)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 — View Directory Metadata Before Onboarding (Priority: P3)

**Goal**: Discovered directories show git indicator and spec-kit artifact badges so users can make informed onboarding decisions.

**Independent Test**: Place directories with varying states (git repo, plain folder, with/without spec-kit artifacts) and verify correct metadata indicators appear on dashboard cards.

### Implementation for User Story 3

- [ ] T020 [US3] Add metadata display to discovered directory cards in src/client/components/dashboard.tsx — git indicator badge, spec-kit artifact badges (spec, plan, tasks), style with visual distinction from registered cards
- [ ] T021 [US3] Handle the "no metadata" case in src/client/components/dashboard.tsx — directory with no git and no spec-kit shows only name + Onboard button

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, error handling, and cross-story improvements

- [ ] T022 [P] Handle edge case: registered project directory missing from disk — show `dirMissing` warning in dashboard card in src/client/components/dashboard.tsx
- [ ] T023 [P] Handle edge case: projectsDir does not exist — show `discoveryError` banner in src/client/components/dashboard.tsx
- [ ] T024 Run quickstart.md validation — start dev server, verify all endpoints and UI per specs/003-project-discovery/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion
- **User Story 2 (Phase 4)**: Depends on Phase 2 completion; integrates with US1 API changes (T013)
- **User Story 3 (Phase 5)**: Depends on Phase 2 completion; builds on US1 dashboard (T014)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational — no dependencies on other stories
- **User Story 2 (P2)**: Depends on US1's `POST` route infrastructure (T013) and dashboard (T014) being in place
- **User Story 3 (P3)**: Depends on US1's dashboard cards (T014) being in place — adds metadata to existing cards

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Service functions before route handlers
- Route handlers before client components
- Core implementation before error handling

### Parallel Opportunities

- T007, T008, T009 can all run in parallel (different test files)
- T010, T011 can run in parallel (independent detection functions in same file, but no overlap)
- T017 can start as soon as Phase 2 is complete (independent test file)
- T022, T023 can run in parallel (different UI concerns)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for US1 together:
Task T007: "Unit tests for scanProjectsDir() in tests/unit/discovery.test.ts"
Task T008: "Unit tests for detectGitRepo()/detectSpecKitArtifacts() in tests/unit/discovery.test.ts"
Task T009: "Integration tests for GET /api/projects in tests/integration/discovery-api.test.ts"

# Then implement detection functions in parallel:
Task T010: "Implement detectGitRepo() in src/services/discovery.ts"
Task T011: "Implement detectSpecKitArtifacts() in src/services/discovery.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T006)
3. Complete Phase 3: User Story 1 (T007–T016)
4. **STOP and VALIDATE**: Test US1 independently — dashboard shows registered + discovered
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy (MVP!)
3. Add User Story 2 → Test independently → Deploy (onboarding works)
4. Add User Story 3 → Test independently → Deploy (metadata visible)
5. Polish → Edge cases handled → Final validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Breaking change: `GET /api/projects` response shape changes from array to object — client and server must update together (T013 + T014)
