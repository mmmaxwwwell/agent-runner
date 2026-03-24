# Research: Bugfixes, UI Flow Documentation, and Integration Tests

## US1: Missing POST /api/workflows/new-project Endpoint

### Decision: Wire new route to existing `startNewProjectWorkflow()` in `src/routes/projects.ts`

**Rationale**: The orchestrator function `startNewProjectWorkflow()` in `src/services/spec-kit.ts` is fully implemented. It accepts `{ repoName, description, projectsDir, dataDir, deps }` and runs the full SDD workflow (specify → clarify → plan → tasks → analyze). The only missing piece is an HTTP route handler that:

1. Validates input (`name` required, filesystem-safe; `description` required)
2. Checks no duplicate project name exists in `AGENT_RUNNER_PROJECTS_DIR`
3. Creates a session, wires up `SpecKitDeps` (same pattern as `add-feature` handler)
4. Calls `startNewProjectWorkflow()` asynchronously
5. Returns `{ sessionId, projectId, phase: "specify", state: "running" }`

**Alternatives considered**:
- Creating a separate route file (`src/routes/workflows.ts`) — rejected because the add-feature workflow is already in `projects.ts` and this follows the same pattern. Adding a new file for one endpoint violates YAGNI.
- Using `POST /api/projects` with an extended body — rejected because the existing `POST /api/projects` registers an *existing* project directory, while new-project *creates* a directory and starts a workflow. Different semantics warrant a distinct endpoint.

### Key implementation detail

The client calls `POST /api/workflows/new-project` (via `api.ts` which prepends `/api`). The route key in `apiRoutes` must be `POST /api/workflows/new-project`. The handler follows the same `SpecKitDeps` wiring pattern as the existing `POST /api/projects/:id/add-feature` handler (lines 172-330 of `src/routes/projects.ts`).

The endpoint creates the project directory under `AGENT_RUNNER_PROJECTS_DIR/<name>/` before delegating to the orchestrator. The `deps.registerProject` callback is used (unlike add-feature where it's a no-op) to auto-register the project after successful workflow completion.

### Duplicate name detection

Check if `<AGENT_RUNNER_PROJECTS_DIR>/<name>` already exists as a directory, OR if a project with the same name is already registered in `projects.json`. Return 409 Conflict for either case. Use `existsSync` for the directory check (synchronous is fine — single check, local filesystem).

---

## US2: Microphone Premature Disengagement

### Decision: Set `continuous: true`, `interimResults: true`, accumulate results, auto-stop on silence timeout

**Rationale**: The Web Speech API's `SpeechRecognition` interface with `continuous: false` stops after the first recognized utterance boundary (typically 1-2 seconds of silence). Setting `continuous: true` keeps the recognition session open, allowing multiple speech segments to be captured.

**Implementation approach**:

1. In `transcribeBrowser()` and `startListeningBrowser()`:
   - Set `recognition.continuous = true`
   - Set `recognition.interimResults = true`
   - Accumulate final results across multiple `onresult` events using `event.results` iteration
   - Track a silence timer: reset on each `onresult`, fire after 5 seconds of no results
   - On silence timeout or explicit `stopListening()`, call `recognition.stop()` and resolve with accumulated text

2. The `onresult` handler must iterate `event.results` from `event.resultIndex` to `event.results.length`, checking `isFinal` to separate confirmed text from interim text.

3. The interim text can be exposed via a callback for real-time display (the components already use `onVoiceStateChange` — extend or add an `onInterimResult` listener).

**Alternatives considered**:
- Using `webkitSpeechGrammarList` to improve recognition — rejected as it's poorly supported and doesn't address the continuous listening requirement.
- Switching entirely to cloud backend — rejected because browser-native speech is zero-latency and free. Cloud is already available as a fallback.

### Silence timeout design

Use a configurable timeout (default 5000ms). Reset the timer on every `onresult` event (including interim results). When the timer fires, call `recognition.stop()`. The `onend` event then resolves the promise with accumulated text.

---

## US3: UI Flow Document

### Decision: Create `UI_FLOW.md` at project root with Mermaid flowchart, sequence diagrams, screen details, and validation table

**Rationale**: This is a documentation task requiring thorough reading of all client components, routes, WebSocket handlers, and models. The document structure is fully specified in the spec (FR-008, FR-009).

**Approach**:
1. Read every file in `src/client/components/` to map screens and user actions
2. Read `src/routes/` to map all API endpoints
3. Read `src/ws/` to map WebSocket connections
4. Read `src/models/session.ts` for state transitions
5. Synthesize into Mermaid diagrams and screen-by-screen sections

No implementation decisions needed — this is documentation extraction.

---

## US4: Integration Tests

### Decision: Use Node.js built-in `node:test` with real HTTP server instances, test against actual API contracts

**Rationale**: Consistent with existing test infrastructure. The project already has 5 integration tests and 5 contract tests using `node:test` + `assert/strict`.

**Test server pattern**: Follow the existing pattern in `tests/contract/rest-api.test.ts` — spin up a real server instance on a random port, make HTTP requests, assert responses. For WebSocket tests, connect with the `ws` library.

**Key constraint from Constitution VII**: Mocks are only acceptable for `child_process.spawn` and `systemd-run`. All other tests use real data. Integration tests that test the new-project workflow must mock process spawning (since we can't run actual `claude` processes in tests) but should use real filesystem, real HTTP server, and real WebSocket connections.

**Test organization**: 5 new test files as specified in the spec (US4 test categories). Each test references the specific `UI_FLOW.md` section it validates via comments.
