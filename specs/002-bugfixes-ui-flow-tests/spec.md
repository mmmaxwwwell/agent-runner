# Feature Specification: Bugfixes, UI Flow Documentation, and Integration Tests

**Feature Branch**: `002-bugfixes-ui-flow-tests`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User reported "not found" error on Start Project button, mic button disengages after ~1 second, needs comprehensive UI flow diagram and integration tests.

## User Scenarios & Testing

### User Story 1 - Fix "Not Found" Error on Start Project (Priority: P1)

When a user navigates to the New Project screen (`#/new`), fills in a repository name and description, and clicks "Start Project", they receive a "not found" error. The root cause is that the client component (`src/client/components/new-project.tsx`) POSTs to `POST /workflows/new-project`, but **this endpoint does not exist on the server**. The spec-kit workflow orchestrator (`src/services/spec-kit.ts`) exports `startNewProjectWorkflow()` but it is never wired to any HTTP route. A new endpoint must be created, wired into `src/server.ts`, and connected to the existing orchestrator.

**Why this priority**: This is a complete blocker — the primary new-project creation flow is non-functional. Users cannot create projects through the app at all.

**Independent Test**: Navigate to `#/new`, fill in name "test-project" and description "A simple test", click "Start Project", verify the workflow begins (session created, first phase "specify" starts, WebSocket connection established for streaming output).

**Root Cause Analysis**:
- Client calls: `POST /api/workflows/new-project` with body `{ name, description }`
- Expected response: `{ sessionId, projectId, phase, state }`
- Server has no route matching this path — the API route matching in `src/server.ts` finds no match and returns 404
- The orchestrator function `startNewProjectWorkflow(name, description, deps)` exists in `src/services/spec-kit.ts` and is fully implemented — it just needs an HTTP endpoint to invoke it

**Acceptance Scenarios**:

1. **Given** the user is on the New Project screen (`#/new`), **When** they enter a valid name and description and click "Start Project", **Then** the server creates a project directory under `AGENT_RUNNER_PROJECTS_DIR/<name>/`, initializes a spec-kit workflow session, and returns `{ sessionId, projectId, phase: "specify", state: "running" }` with status 200.
2. **Given** the user clicks "Start Project" with an empty name, **When** the request is sent, **Then** the server responds with 400 and an error message indicating the name is required.
3. **Given** the user clicks "Start Project" with a name that already exists as a registered project, **When** the request is sent, **Then** the server responds with 409 Conflict indicating a project with that name already exists.
4. **Given** a valid "Start Project" request succeeds, **When** the client receives the response, **Then** it transitions to the SpecKitChat view, connects to `/ws/sessions/:sessionId`, and displays streaming output from the "specify" phase.

**Field Validations**:
- `name`: Required, non-empty after trimming, must be a valid directory name (no special characters that would break filesystem paths)
- `description`: Required, non-empty after trimming

---

### User Story 2 - Fix Microphone Button Premature Disengagement (Priority: P1)

The mic button on the New Project screen (and Add Feature screen) only listens for approximately 1 second before disengaging. The root cause is in `src/client/lib/voice.ts`: the browser backend uses `SpeechRecognition` with `continuous: false` and `interimResults: false`. With these settings, the Web Speech API stops recognition on the first detected silence pause (often ~1-2 seconds), making it nearly unusable for dictating project descriptions.

**Why this priority**: Voice input is a core interaction pattern for the app (per the spec, users should be able to describe projects via voice). If it stops after 1 second, it's effectively broken.

**Independent Test**: Click the mic button, speak a multi-sentence project description over 10+ seconds, verify the full transcription appears in the description field.

**Root Cause Analysis**:
- In `src/client/lib/voice.ts`, `transcribeBrowser()` creates a `SpeechRecognition` instance with:
  - `continuous = false` — recognition stops after first result
  - `interimResults = false` — no partial results shown
- The `onend` event fires immediately after first pause detection, resolving the promise
- Fix: Set `continuous = true` to keep listening, accumulate results, and provide a way for the user to explicitly stop (e.g., click the mic button again, or auto-stop after a longer silence)

**Acceptance Scenarios**:

1. **Given** the user is on the New Project screen and clicks the mic button, **When** they speak continuously for 15 seconds, **Then** the full transcription appears in the description field without premature cutoff.
2. **Given** the user is speaking and pauses for 2-3 seconds mid-sentence, **When** they resume speaking, **Then** the recognition continues capturing and the full text (before and after the pause) appears in the description field.
3. **Given** the user is speaking and clicks the mic button again (toggle off), **When** the mic is toggled off, **Then** the recognition stops and the accumulated transcription up to that point appears in the description field.
4. **Given** the user clicks the mic button but doesn't speak for 10 seconds, **When** the silence timeout is reached, **Then** the recognition stops gracefully and any partial text is preserved.
5. **Given** the user is on the Add Feature screen, **When** they use the mic button, **Then** the same improved voice capture behavior applies (shared `voice.ts` module).

**UX Notes**:
- The mic button should toggle: first click starts listening, second click stops
- While listening, show a visual indicator (pulsing animation or recording indicator)
- Show interim/partial transcription results in real-time as the user speaks (set `interimResults: true`)
- Auto-stop after a configurable silence timeout (suggest 5-10 seconds of no speech)

---

### User Story 3 - Create Comprehensive UI Flow Diagram (Priority: P1)

Create a `UI_FLOW.md` file in the project root containing a comprehensive Mermaid diagram of the entire application's UI flow. This document must serve as the authoritative reference for how screens, user actions, API calls, WebSocket connections, and state transitions interconnect. It must contain enough detail that an autonomous agent could fully understand the app's behavior without reading the source code.

**Why this priority**: This is a prerequisite for User Story 4 (integration tests). The diagram provides the test plan and validates the team's shared understanding of the app.

**Independent Test**: Open `UI_FLOW.md`, render the Mermaid diagram, verify every screen/route is represented, every user action is mapped, every API call is documented, and every field validation is noted.

**Acceptance Scenarios**:

1. **Given** a developer opens `UI_FLOW.md`, **When** they render the Mermaid diagram, **Then** they can trace every possible user journey from app launch to completion of any feature.
2. **Given** an autonomous agent reads `UI_FLOW.md`, **When** it needs to understand what happens when a user clicks any button, **Then** the diagram and annotations provide the complete flow including API endpoints, expected responses, WebSocket messages, and state transitions.

**Required Content**:

The `UI_FLOW.md` MUST include:

#### Main Mermaid Flow Diagram
A `flowchart TD` diagram covering:
- **All screens/routes**: Dashboard (`#/`), New Project (`#/new`), Project Detail (`#/projects/:id`), Session View (`#/sessions/:id`), Add Feature (`#/projects/:id/add-feature`), Settings (`#/settings`)
- **Navigation transitions**: What user action triggers navigation between screens
- **API calls**: Which endpoints each screen calls on load and on user action
- **WebSocket connections**: Which screens establish WebSocket connections and to which paths
- **State transitions**: Session states (running, waiting-for-input, completed, failed), workflow phases (specify, clarify, plan, tasks, analyze)
- **Error paths**: What happens when API calls fail, WebSocket disconnects, validation fails

#### Screen-by-Screen Detail Sections
For each screen, a subsection containing:
- **Route**: Hash route pattern
- **On Load**: API calls made when screen mounts
- **User Actions**: Every interactive element and what it does
- **Field Validations**: Input constraints (required, format, length)
- **Real-time Updates**: WebSocket message types consumed
- **Navigation Out**: Where each action takes the user
- **Error States**: What errors can occur and how they're displayed

#### API Interaction Map
A separate Mermaid `sequenceDiagram` showing:
- The New Project workflow (client → server → spec-kit orchestrator → WebSocket streaming)
- The Add Feature workflow
- The session lifecycle (start → monitor → input → stop)
- Push notification subscription flow

#### Field Validation Reference Table
A markdown table listing every input field in the app with:
- Screen name
- Field name
- Required/optional
- Validation rules
- Error message shown

---

### User Story 4 - Write Integration Tests for All UI Flows (Priority: P2)

Write comprehensive integration tests that validate all application functionality end-to-end. These tests MUST reference `UI_FLOW.md` as their test plan — every flow documented in the diagram must have a corresponding test. Tests should validate the server-side behavior (API endpoints, WebSocket messages, session lifecycle) and ensure the flows described in `UI_FLOW.md` work correctly.

**Why this priority**: P2 because it depends on US1, US2 (bug fixes) and US3 (UI flow doc) being complete first. The tests validate the fixes and use the flow document as the test specification.

**Independent Test**: Run `npm test` and verify all new integration tests pass, covering every flow documented in `UI_FLOW.md`.

**Acceptance Scenarios**:

1. **Given** the `UI_FLOW.md` documents the New Project flow, **When** integration tests run, **Then** there is a test that exercises `POST /api/workflows/new-project` with valid input, verifies session creation, and validates the response matches the documented contract.
2. **Given** the `UI_FLOW.md` documents field validations, **When** integration tests run, **Then** there are tests for every validation rule (empty name, duplicate name, empty description, etc.) verifying the documented error responses.
3. **Given** the `UI_FLOW.md` documents the session lifecycle, **When** integration tests run, **Then** there are tests covering: start session, stream output via WebSocket, submit input when waiting, stop session, and verify state transitions match the diagram.
4. **Given** the `UI_FLOW.md` documents the Add Feature flow, **When** integration tests run, **Then** there is a test exercising `POST /api/projects/:id/add-feature` and verifying the workflow phases progress as documented.
5. **Given** all integration tests pass, **When** a developer checks the test file, **Then** each test references the specific `UI_FLOW.md` section it validates (via comments like `// Validates UI_FLOW.md § New Project Flow`).

**Test Categories**:

1. **New Project Workflow Tests** (`tests/integration/new-project-workflow.test.ts`):
   - Valid project creation → session starts → phases progress
   - Validation errors (empty name, empty description, duplicate name)
   - WebSocket streaming during workflow phases

2. **Voice Input Tests** (`tests/integration/voice-api.test.ts`):
   - Transcription endpoint with valid audio
   - Transcription endpoint without API key (503)
   - Transcription endpoint with no audio (400)

3. **Session Lifecycle Tests** (`tests/integration/session-lifecycle.test.ts`):
   - Full lifecycle: create → run → complete
   - Blocked flow: create → run → waiting-for-input → input → resume → complete
   - Stop flow: create → run → stop → failed
   - Concurrent session prevention

4. **Dashboard & Navigation Tests** (`tests/integration/dashboard-api.test.ts`):
   - Project list with task summaries
   - Project detail with sessions and tasks
   - WebSocket dashboard updates on session state change

5. **Add Feature Workflow Tests** (`tests/integration/add-feature-workflow.test.ts`):
   - Valid add-feature request → workflow starts
   - Validation errors (no active session allowed, empty description, unknown project)
   - Phase transitions broadcast via WebSocket

---

### Edge Cases

- What happens when the server is restarted mid-workflow? (Crash recovery should resume or mark failed)
- What happens when the WebSocket disconnects during a spec-kit phase? (Client reconnects with lastSeq, replays missed output)
- What happens when the user navigates away from the New Project screen mid-workflow? (Session continues server-side, user can return via session view)
- What happens when disk space is low during project creation? (Disk monitor should warn before directory creation fails)
- What happens when the mic permission is denied by the browser? (Should fall back gracefully, show error, let user type instead)
- What happens when both Web Speech API and Google STT are unavailable? (Mic button should be disabled or hidden)

## Requirements

### Functional Requirements

- **FR-001**: System MUST expose `POST /api/workflows/new-project` endpoint that accepts `{ name, description }` and returns `{ sessionId, projectId, phase, state }` to fix the missing route causing the "not found" error.
- **FR-002**: System MUST validate the `name` field is non-empty, contains only filesystem-safe characters, and is not already registered as a project.
- **FR-003**: System MUST validate the `description` field is non-empty.
- **FR-004**: The voice module MUST use `continuous: true` on the `SpeechRecognition` API so that recognition persists across natural speech pauses.
- **FR-005**: The voice module MUST set `interimResults: true` to show real-time partial transcription as the user speaks.
- **FR-006**: The mic button MUST function as a toggle — first click starts listening, second click stops and finalizes the transcription.
- **FR-007**: The voice module MUST auto-stop after a configurable silence timeout (default 5 seconds of no speech detected) to avoid indefinite listening.
- **FR-008**: `UI_FLOW.md` MUST be created in the project root with a complete Mermaid flowchart diagram covering all screens, routes, user actions, API calls, WebSocket connections, and state transitions.
- **FR-009**: `UI_FLOW.md` MUST include field validation tables, screen-by-screen detail sections, and API sequence diagrams.
- **FR-010**: Integration tests MUST be written for every flow documented in `UI_FLOW.md`, with each test referencing the specific section it validates.
- **FR-011**: Integration tests MUST cover the fixed New Project workflow end-to-end.
- **FR-012**: Integration tests MUST cover voice transcription API endpoint behavior.
- **FR-013**: Integration tests MUST cover session lifecycle flows (start, monitor, input, stop).
- **FR-014**: Integration tests MUST cover the Add Feature workflow.

### Key Entities

- **Workflow**: A multi-phase spec-kit process (specify → clarify → plan → tasks → analyze) that runs as sequential sessions against a project directory. Not persisted as its own entity — tracked via session chain.
- **UI Flow Document**: A markdown file (`UI_FLOW.md`) containing Mermaid diagrams and annotations that serve as the authoritative reference for all application UI behavior and the test specification for integration tests.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Clicking "Start Project" with valid input successfully creates a project and starts the spec-kit workflow — zero "not found" errors.
- **SC-002**: The mic button captures at least 30 seconds of continuous speech without premature disengagement.
- **SC-003**: `UI_FLOW.md` covers 100% of the app's screens (6 screens) and all API endpoints (12+ endpoints).
- **SC-004**: Integration test suite achieves coverage of every flow documented in `UI_FLOW.md` — no undocumented or untested flows.
- **SC-005**: All integration tests pass with `npm test`.
