# Implementation Plan: Onboarding Overhaul

**Branch**: `004-onboarding-overhaul` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-onboarding-overhaul/spec.md`

## Summary

Unify the project onboarding and creation flows into a single idempotent pipeline that takes any directory (new or existing) from zero to a running Claude spec-kit interview session. Key changes: migrate data directory to XDG standard, manage an agent-framework git clone for skill files, enhance the sandbox to inject `claude-code`/`uv` via `nix shell` composition, add a server-side transcript parser, and replace the shallow spec-kit interview with an exhaustive single-session interview driven by a reusable wrapper prompt.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (via Nix flake)
**Primary Dependencies**: `ws` (WebSocket), `web-push` (push notifications), `pino` (logging), `preact` (PWA client), `esbuild` (client bundler)
**Storage**: Filesystem — `~/.local/share/agent-runner/projects.json`, session metadata in `sessions/{id}/meta.json`, output in `sessions/{id}/output.jsonl`
**Testing**: Node.js built-in test runner (`node:test`), `assert`
**Target Platform**: NixOS (Linux), systemd-run --user sandbox
**Project Type**: Web service + PWA client
**Performance Goals**: N/A (single-user, local)
**Constraints**: All processes sandboxed via systemd-run; nix flake environment required; agent-framework skills available read-only in sandbox
**Scale/Scope**: Single user, ~10-50 projects, 1 active session per project

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Sandbox-First Security | PASS | All commands (init steps + sessions) run in sandbox. Agent-framework mounted read-only. Nix cache bind-mounted for functionality. |
| II. Markdown-as-Database | PASS | No new database. Transcript and interview-notes are markdown files in spec directory. |
| III. Thin Client | PASS | PWA remains read-only monitoring + input. Onboarding logic is server-side. |
| IV. NixOS-Native | PASS | All processes via `nix develop`. Tooling injected via `nix shell` composition. |
| V. Simplicity & YAGNI | PASS | Unified onboarding replaces two separate flows. No new abstractions beyond what's needed. |
| VI. Process Isolation | PASS | Each session is independent. Transcript parser is server-side, not in-process with agent. |
| VII. Test-First | PASS | Tests required for: sandbox preset generation, onboarding pipeline idempotency, transcript parser, flake generation with arch detection. |

## Project Structure

### Documentation (this feature)

```text
specs/004-onboarding-overhaul/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── rest-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   └── config.ts                    # MODIFY — new default dataDir, add agentFrameworkDir
├── models/
│   └── project.ts                   # MODIFY — add description field
├── services/
│   ├── sandbox.ts                   # MODIFY — session type presets, nix shell wrapper, new BindPaths
│   ├── flake-generator.ts           # MODIFY — architecture detection
│   ├── spec-kit.ts                  # MODIFY — unified onboarding pipeline, single interview session
│   ├── agent-framework.ts           # NEW — clone/pull management
│   ├── transcript-parser.ts         # NEW — output.jsonl → transcript.md
│   ├── onboarding.ts                # NEW — idempotent step pipeline
│   └── discovery.ts                 # unchanged
├── routes/
│   └── projects.ts                  # MODIFY — unified onboard endpoint, remove new-project workflow
├── ws/
│   ├── session-stream.ts            # unchanged
│   └── dashboard.ts                 # MODIFY — onboarding-step messages
├── client/
│   ├── components/
│   │   ├── dashboard.tsx            # MODIFY — onboarding step progress
│   │   ├── new-project.tsx          # MODIFY — remove description field
│   │   └── spec-kit-chat.tsx        # unchanged
│   └── lib/
│       └── api.ts                   # MODIFY — unified onboard API
└── server.ts                        # MODIFY — agent-framework clone on startup

tests/
├── unit/
│   ├── sandbox.test.ts              # MODIFY — test new presets, BindPaths
│   ├── flake-generator.test.ts      # MODIFY — test arch detection
│   ├── transcript-parser.test.ts    # NEW
│   ├── onboarding.test.ts           # NEW
│   └── agent-framework.test.ts      # NEW
├── integration/
│   ├── onboard-api.test.ts          # MODIFY — test unified endpoint
│   └── onboarding-pipeline.test.ts  # NEW — end-to-end pipeline test
└── contract/
    └── rest-api-projects.test.ts    # MODIFY — updated onboard contract
```

**Structure Decision**: Existing single-project structure. Three new service modules (`agent-framework.ts`, `transcript-parser.ts`, `onboarding.ts`) follow the established pattern of one service per concern. The `onboarding.ts` module orchestrates the idempotent step pipeline, keeping it separate from the route handler.

## Complexity Tracking

No constitution violations requiring justification.

## Implementation Approach

### Phase 1: Infrastructure (Foundation)

1. **Config migration** — Change `resolveDataDir()` default to `~/.local/share/agent-runner/`. Add `agentFrameworkDir` derived property.

2. **Agent framework management** — New `agent-framework.ts` service:
   - `ensureAgentFramework(dataDir)` — clone if missing, pull if exists
   - Called on server startup and before each session launch
   - Hardcoded repo URL constant

3. **Sandbox enhancements** — Modify `buildCommand()`:
   - New signature with session type and options object
   - Preset flags per type (both: `--output-format stream-json --dangerously-skip-permissions --model opus`)
   - Add `BindPaths` for `~/.cache/nix` and `~/.local/share/uv`
   - Add `BindReadOnlyPaths` for agent-framework directory
   - Wrap command in `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code github:NixOS/nixpkgs/nixpkgs-unstable#uv --command ...`

4. **Flake generator** — Add architecture detection using `process.arch` + `process.platform`. Update all templates.

### Phase 2: Onboarding Pipeline

5. **Onboarding service** — New `onboarding.ts`:
   - Idempotent step pipeline with check/execute pattern
   - Steps: register → create-dir → generate-flake → git-init → git-remote → install-specify → specify-init → launch-interview
   - Each step runs inside sandbox (via `buildCommand()`)
   - Broadcasts step progress via WebSocket

6. **Unified API endpoint** — Modify `POST /api/projects/onboard` to handle both discovered dirs and new projects. Remove `POST /api/workflows/new-project`.

7. **Project model** — Add `description: string | null` field.

### Phase 3: Interview System

8. **Interview wrapper prompt** — Create `.claude/skills/spec-kit/interview-wrapper.md` in agent-framework repo (external, not in this codebase — but referenced and tested).

9. **Single interview session** — Modify spec-kit workflow to launch one long-running Claude session for the interview phase (specify + clarify loop), then separate sessions for plan/tasks/analyze.

10. **Transcript parser** — New `transcript-parser.ts`:
    - Watches `output.jsonl` via polling (reuse existing pattern from session-stream)
    - Parses Claude CLI `stream-json` format
    - Extracts assistant text blocks → `## Agent` sections
    - Extracts user stdin → `## User` sections
    - Appends to `transcript.md` incrementally

### Phase 4: UI Changes

11. **Simplified new-project form** — Remove description textarea from `new-project.tsx`.

12. **Onboarding progress** — Dashboard shows step-by-step onboarding progress via WebSocket messages.

### Phase 5: Polish

13. **Agent-generated description** — After interview completes, update project registry with description from `interview-notes.md`.

14. **Status transitions** — `onboarding` → `active` on interview completion; `onboarding` → `error` on failure.
