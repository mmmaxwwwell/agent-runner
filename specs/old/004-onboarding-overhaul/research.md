# Research: Onboarding Overhaul

## Decision 1: Nix Shell Composition for Tooling Injection

**Decision**: Use `nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code github:NixOS/nixpkgs/nixpkgs-unstable#uv --command nix develop {projectDir} --command claude ...` to inject agent-runner tooling without polluting project flakes.

**Rationale**: `claude-code` and `uv` are agent-runner infrastructure, not project dependencies. Verified experimentally that `nix shell ... --command nix develop ... --command ...` correctly composes — the outer shell adds packages to PATH, then `nix develop` adds the project's devShell on top. The inner command sees both.

**Alternatives considered**:
- Adding `claude-code`/`uv` to generated flake templates — rejected because it leaks infrastructure into project files
- Patching existing flake.nix files to inject packages — rejected because arbitrary nix file parsing is unreliable
- Using a wrapper flake that composes inputs — rejected as over-engineered

## Decision 2: Sandbox BindPaths for Nix/uv Cache

**Decision**: Add `~/.cache/nix` and `~/.local/share/uv` to `BindPaths` in the systemd sandbox.

**Rationale**: `ProtectHome=tmpfs` blocks access to nix's user cache (`~/.cache/nix`), causing `nix shell` to fail with "creating directory: Read-only file system". Verified experimentally: adding `BindPaths` for the cache directory resolves the issue. Multiple bind paths work via space-separated values in a single `--property=BindPaths=...` directive. `uv` needs `~/.local/share/uv` for tool installations.

**Alternatives considered**:
- Removing `ProtectHome=tmpfs` entirely — rejected because it removes the core filesystem isolation
- Pre-fetching nix packages outside the sandbox — rejected as it adds complexity and race conditions

## Decision 3: Data Directory Migration

**Decision**: Change default data directory from `~/.agent-runner/` to `~/.local/share/agent-runner/`.

**Rationale**: XDG Base Directory standard. Works for both `systemd --user` (user mode) and future `systemd` system-level deployment (`/var/lib/agent-runner/` via `AGENT_RUNNER_DATA_DIR`). No auto-migration — clean break.

**Alternatives considered**:
- Keeping `~/.agent-runner/` — rejected because it's non-standard and problematic for system-level deployment
- Auto-migration with symlink — rejected to keep it simple; no valuable data in current directory

## Decision 4: Agent Framework as Managed Clone

**Decision**: Clone `https://github.com/mmmaxwwwell/agent-framework` to `<dataDir>/agent-framework/` on startup, `git pull` before each session.

**Rationale**: The agent-framework contains skill files, interview wrapper, and run-tasks.sh needed by sandboxed agents. On a deployed server, the framework won't be at a known path. Cloning to a managed location under the data directory keeps it co-located with other runtime state. Git pull before each session ensures skills stay current without rebuilding agent-runner.

**Alternatives considered**:
- Bundling skill files in agent-runner's npm package — rejected because it requires rebuilding agent-runner for every framework change
- Copying needed files into project directories — rejected because copies get stale
- Adding agent-framework as a git submodule — rejected because it couples release cycles

## Decision 5: Sandbox ReadOnly Bind for Agent Framework

**Decision**: Mount agent-framework via `BindReadOnlyPaths` in the systemd sandbox.

**Rationale**: The agent needs to read ROUTER.md, SKILL.md, interview-wrapper.md, and execute run-tasks.sh. Read-only prevents the sandboxed agent from modifying the shared framework files. Verified that `BindReadOnlyPaths` works alongside `BindPaths`.

**Alternatives considered**:
- Read-write bind — rejected because agents shouldn't modify framework files
- Inlining prompt content via `-p` — rejected because run-tasks.sh needs to be executable, not just readable

## Decision 6: Architecture Detection for Flake Templates

**Decision**: Detect host architecture at runtime using `process.arch` and `process.platform`, mapping to nix system strings.

**Rationale**: Current flake templates hardcode `x86_64-linux`. Node's `process.arch` returns `x64`, `arm64`, etc. and `process.platform` returns `linux`, `darwin`, etc. Map: `x64`+`linux` → `x86_64-linux`, `arm64`+`linux` → `aarch64-linux`.

**Alternatives considered**:
- Running `nix eval --expr builtins.currentSystem` — works but spawns a process for something trivially derivable
- Hardcoding x86_64-linux — rejected because aarch64 servers exist

## Decision 7: Session Type Presets for buildCommand()

**Decision**: `buildCommand()` accepts a session type and applies flag presets. Both types include `--output-format stream-json`, `--dangerously-skip-permissions`, `--model opus`.

**Rationale**: Every session needs structured JSON output (for transcript parser), tool permissions (agents run unattended), and the opus model (1M context). Centralizing these in `buildCommand()` prevents callers from forgetting flags. Interview preset supports optional `-p` for the initial prompt. Task-run preset requires `-p` with the task prompt.

**Alternatives considered**:
- Caller builds all flags — rejected because it's error-prone (easy to forget `--output-format stream-json`)
- Separate builder functions per type — rejected as unnecessary when a type parameter suffices

## Decision 8: Single Interview Session

**Decision**: The specify→clarify loop runs as a single long-running Claude session, not separate sessions per phase.

**Rationale**: The interview is conversational — context from earlier questions informs later probing. Splitting into separate sessions loses nuance. 1M opus context is sufficient for even long interviews (estimated 100-200k tokens for a thorough interview). On crash, the agent recovers from `spec.md` + `transcript.md` on disk.

**Alternatives considered**:
- Separate sessions per phase (current approach) — rejected because it loses conversational context
- Checkpoint-based approach — rejected as over-engineered; the spec file itself is the checkpoint

## Decision 9: Server-Side Transcript Parser

**Decision**: A TypeScript service watches `output.jsonl` and writes clean `transcript.md` in real-time. Parses Claude CLI `stream-json` format.

**Rationale**: The transcript must be written without spending agent tokens. Claude CLI's `--output-format stream-json` emits JSON messages with typed content blocks. Messages with `type: "assistant"` contain `message.content` arrays with `text` and `tool_use` blocks. User stdin input appears as separate entries. The parser extracts text blocks as `## Agent` sections and stdin as `## User` sections.

**Alternatives considered**:
- Having the agent write the transcript — rejected because it wastes tokens on a mechanical task
- Post-processing after session ends — rejected because real-time transcript enables crash recovery

## Decision 10: Interview Wrapper Prompt Location

**Decision**: Interview wrapper lives at `.claude/skills/spec-kit/interview-wrapper.md` in the agent-framework repo.

**Rationale**: Reusable across all projects using the agent-framework. Updated via git pull without rebuilding agent-runner. The wrapper instructs the agent to use spec-kit templates, research similar projects, and loop exhaustively.

**Alternatives considered**:
- In agent-runner codebase — rejected because it's not reusable across other projects
- Inline in buildCommand() — rejected because it's not maintainable
