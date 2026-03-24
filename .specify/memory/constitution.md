<!--
  Sync Impact Report
  Version change: 1.2.0 → 1.3.0
  Amended: Sandbox-First Security (added SSH agent socket to allowed infrastructure bind paths)
  Templates requiring updates: None (spec/plan/tasks already use new paths)
  Follow-up TODOs: None
-->

# Agent Runner Constitution

## Core Principles

### I. Sandbox-First Security

Every agent process MUST be sandboxed via `systemd-run --user --scope` with `ProtectHome=tmpfs` and `BindPaths=<project-dir>`. An agent MUST NOT have access to files outside its project directory, except for infrastructure paths required by the runtime: nix cache (`~/.cache/nix`), uv tool storage (`~/.local/share/uv`), the agent-framework directory (read-only via `BindReadOnlyPaths`), and per-session SSH agent bridge sockets (`<dataDir>/sessions/<sessionId>/agent.sock`). Unsandboxed execution requires two gates: (1) the server MUST be started with `ALLOW_UNSANDBOXED=true` environment variable, AND (2) the session start request MUST include `allowUnsandboxed: true`. If either gate is missing, the server MUST refuse to start the session. Unsandboxed execution MUST produce a visible warning in both server logs and session output. Security boundaries are non-negotiable — convenience never justifies weakening the sandbox.

### II. Markdown-as-Database

Agent-framework markdown files (task lists, notes, prompts) are the single source of truth for project state. The server MUST NOT maintain a parallel database. The only server-side state file is the project registry (`<dataDir>/projects.json`). Session metadata (`meta.json`) and output logs are append-only artifacts, not authoritative state.

### III. Thin Client

The PWA is a read-only monitoring and input interface. All process management, state tracking, and decision logic MUST live on the server. If the client disconnects, nothing is lost — the server continues running and logging. On reconnect, the client replays from server logs. The client MUST NOT cache or derive state independently.

### IV. NixOS-Native

The project runs on NixOS. All dependencies MUST be declared in `flake.nix`. Agent processes MUST run via `nix develop <project-dir> --command` to inherit the project's toolchain. No global npm installs, no system-level package manager commands. The flake is the single entry point for the dev environment.

### V. Simplicity & YAGNI

Start with the minimum viable implementation. No abstractions until there are at least three concrete uses. No resource limits, rate limiting, authentication, or multi-user support until explicitly needed. Features are added when a real use case demands them, not speculatively. Three similar lines of code are better than a premature abstraction.

### VI. Process Isolation

Each claude session (interview or task-run) is an independent process with its own log file, metadata, and lifecycle. Sessions MUST NOT share state through the process manager — they communicate only through the filesystem (markdown files) and the event system. The process manager tracks running processes but does not orchestrate inter-process communication.

### VII. Test-First

New modules MUST have tests written before implementation. Tests MUST fail before the implementation is written (red-green-refactor). Integration tests are required for: sandbox command generation, task file parsing, WebSocket message handling, and the task-run loop. Unit tests cover pure functions. Mocks are acceptable only for `child_process.spawn` and `systemd-run` — all other tests use real data.

## Platform Constraints

- **OS**: NixOS (Linux). `systemd-run --user` is available by default.
- **Runtime**: Node.js 22 via Nix flake. TypeScript compiled with `tsc`, run with `tsx` in development.
- **Process spawning**: `child_process.spawn` only — no `exec` or `execSync` for long-running processes.
- **WebSocket**: `ws` library (not Socket.IO). Raw WebSocket protocol for simplicity.
- **PWA**: Preact with JSX. Client built with esbuild. Source in `src/client/`, output to `public/`.
- **Voice**: Browser-native Web Speech API or Google Speech-to-Text API, switchable at runtime. No local speech processing — the server proxies audio to Google's cloud API but does not run speech models locally.

## Development Workflow

- One task per invocation. Complete, test, commit, then stop.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- `npm run build` and `npm test` MUST pass before marking a task complete.
- Runtime data directory (`~/.local/share/agent-runner/` by default) is never modified during development — only by the running server.
- Changes to the API surface (REST or WebSocket) MUST update the prompt file's API design section.

## Governance

This constitution governs all development decisions for Agent Runner. When a proposed change conflicts with these principles, the principle wins unless the constitution is explicitly amended. Amendments require: (1) a clear rationale documented in the commit message, (2) a version bump following semver, and (3) an updated Sync Impact Report at the top of this file.

Complexity MUST be justified. Any deviation from the simplicity principle requires documenting what simpler alternative was considered and why it was rejected.

**Version**: 1.3.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-03-23
