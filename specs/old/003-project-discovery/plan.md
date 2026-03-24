# Implementation Plan: Project Directory Discovery & Onboarding

**Branch**: `003-project-discovery` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-project-discovery/spec.md`

## Summary

Enable users to see all directories in their configured projects folder on the dashboard, regardless of registration status. Registered projects show task progress and session history as before. Unregistered directories appear with metadata (git status, spec-kit artifacts) and a one-click "Onboard" action that immediately registers the project and optionally starts the SDD workflow. Implementation extends the existing `GET /api/projects` endpoint to scan the filesystem, adds a new `POST /api/projects/onboard` endpoint, updates the Project model with a `status` field, and enhances the dashboard UI to display both project types.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (via Nix flake)
**Primary Dependencies**: `ws` (WebSocket), `web-push` (push notifications), `pino` (logging), `preact` (PWA client), `esbuild` (client bundler)
**Storage**: Filesystem — `~/.agent-runner/projects.json`, session metadata in `sessions/{id}/meta.json`, output in `sessions/{id}/output.jsonl`
**Testing**: Node.js built-in `node:test` + `assert/strict`, run via `tsx --test`
**Target Platform**: NixOS Linux server + browser PWA
**Project Type**: Full-stack web service (HTTP/WebSocket server + Preact PWA)
**Performance Goals**: Directory scan + response within 2 seconds for <100 directories (SC-001)
**Constraints**: All commands via `nix develop -c`; no global installs; `ws` not Socket.IO; Preact not React
**Scale/Scope**: Single-user local app, <100 directories to scan

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Status | Notes |
|---------|--------|-------|
| I. Sandbox-First Security | PASS | No new process spawning. Onboarding delegates to existing workflow which uses `buildCommand()` for sandboxing. |
| II. Markdown-as-Database | PASS | Directory discovery is computed from filesystem, not stored. Project registration uses existing `projects.json`. No new database. |
| III. Thin Client | PASS | Dashboard fetches discovery data from server. No client-side filesystem access. Onboard action is a server API call. |
| IV. NixOS-Native | PASS | No new dependencies. All existing tooling. |
| V. Simplicity & YAGNI | PASS | Minimal new code: one scanning function, one endpoint, one UI section. No live watching, no caching, no polling. |
| VI. Process Isolation | PASS | Onboarding workflow creates independent sessions same as existing new-project flow. |
| VII. Test-First | PASS | Unit tests for discovery service and model changes. Integration tests for API endpoints. |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/003-project-discovery/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── discovery-api.md # API contract
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── models/
│   └── project.ts          # MODIFIED: add status field, registerForOnboarding(), updateProjectStatus()
├── services/
│   └── discovery.ts        # NEW: scanProjectsDir(), detectGitRepo(), detectSpecKitArtifacts()
├── routes/
│   └── projects.ts         # MODIFIED: extend GET /api/projects response, add POST /api/projects/onboard
└── client/
    └── components/
        └── dashboard.tsx   # MODIFIED: two-section layout, DiscoveredCard, onboard action

tests/
├── unit/
│   ├── project.test.ts     # MODIFIED: tests for status field, registerForOnboarding()
│   └── discovery.test.ts   # NEW: tests for directory scanning, filtering, metadata detection
└── integration/
    ├── discovery-api.test.ts  # NEW: GET /api/projects with discovered directories
    └── onboard-api.test.ts    # NEW: POST /api/projects/onboard endpoint
```

**Structure Decision**: Existing single-project structure. One new service file (`discovery.ts`) for the scanning logic, keeping it separate from the model. Route and client changes extend existing files. No structural changes needed.

## Complexity Tracking

No violations. No complexity to justify.
