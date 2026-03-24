# Implementation Plan: Bugfixes, UI Flow Documentation, and Integration Tests

**Branch**: `002-bugfixes-ui-flow-tests` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-bugfixes-ui-flow-tests/spec.md`

## Summary

Fix two P1 bugs (missing `POST /api/workflows/new-project` endpoint and premature mic disengagement), create a comprehensive UI flow document (`UI_FLOW.md`), and write integration tests covering all documented flows. The endpoint bug is a missing route wiring — the orchestrator already exists. The mic bug requires switching `SpeechRecognition` to `continuous: true` with accumulated results and toggle-stop behavior. The UI flow document and integration tests build on the fixes to validate and document the complete application behavior.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (via Nix flake)
**Primary Dependencies**: `ws` (WebSocket), `web-push` (push notifications), `pino` (logging), `preact` (PWA client), `esbuild` (client bundler)
**Storage**: Filesystem — `~/.agent-runner/projects.json`, session metadata in `sessions/{id}/meta.json`, output in `sessions/{id}/output.jsonl`
**Testing**: Node.js built-in `node:test` + `assert/strict`, run via `tsx --test`
**Target Platform**: NixOS Linux server + browser PWA
**Project Type**: Full-stack web service (HTTP/WebSocket server + Preact PWA)
**Performance Goals**: N/A for this bugfix/docs/test feature
**Constraints**: All commands via `nix develop -c`; no global installs; `ws` not Socket.IO; Preact not React
**Scale/Scope**: Single-user local app, 6 screens, 16+ API endpoints, 2 WebSocket paths

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Status | Notes |
|---------|--------|-------|
| I. Sandbox-First Security | PASS | New endpoint delegates to existing `startNewProjectWorkflow()` which uses `buildCommand()` for sandboxing. No new security surface. |
| II. Markdown-as-Database | PASS | No new storage introduced. `UI_FLOW.md` is documentation, not state. |
| III. Thin Client | PASS | Voice fix is client-side but only changes how the browser API is called — no new client state management. The server continues to be the authority. |
| IV. NixOS-Native | PASS | All tooling already in flake. No new dependencies. |
| V. Simplicity & YAGNI | PASS | Bug fixes are minimal targeted changes. UI flow doc is documentation. Integration tests validate existing behavior. No new abstractions. |
| VI. Process Isolation | PASS | New-project workflow creates independent sessions per phase, same as add-feature. |
| VII. Test-First | PASS | US4 writes integration tests for all flows. Existing contract tests validate the new endpoint contract. |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/002-bugfixes-ui-flow-tests/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── new-project-endpoint.md  # New endpoint contract
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── routes/
│   └── projects.ts          # MODIFIED: add POST /api/workflows/new-project handler
├── client/
│   ├── lib/
│   │   └── voice.ts         # MODIFIED: continuous recognition, interim results, toggle, silence timeout
│   └── components/
│       └── new-project.tsx   # VERIFIED: already calls correct endpoint path
├── services/
│   └── spec-kit.ts          # EXISTING: startNewProjectWorkflow() already implemented
└── server.ts                # EXISTING: route dispatching already works with apiRoutes map

tests/
├── integration/
│   ├── new-project-workflow.test.ts   # NEW: US4 — new project creation flow
│   ├── voice-api.test.ts             # NEW: US4 — voice transcription endpoint
│   ├── session-lifecycle.test.ts      # NEW: US4 — full session lifecycle
│   ├── dashboard-api.test.ts          # NEW: US4 — dashboard & navigation
│   └── add-feature-workflow.test.ts   # NEW: US4 — add feature flow

UI_FLOW.md                              # NEW: US3 — comprehensive UI flow document
```

**Structure Decision**: Existing single-project structure. Changes are localized to 2 source files (route + voice module), 1 new documentation file, and 5 new test files. No structural changes needed.

## Complexity Tracking

No violations. No complexity to justify.
