# Data Model: Agent Runner Server and PWA System

**Date**: 2026-03-22 | **Branch**: `001-agent-runner-server-pwa`

## Entities

### Project

A registered agent-framework project tracked by the server.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID, generated on registration |
| `name` | `string` | User-provided display name |
| `dir` | `string` | Absolute path to the project directory |
| `taskFile` | `string` | Relative path to the task file within the project (e.g., `tasks.md`) |
| `promptFile` | `string` | Relative path to the prompt file within the project (e.g., `prompt.md`) |
| `createdAt` | `string` | ISO 8601 timestamp |

**Storage**: `~/.agent-runner/projects.json` — JSON array of project objects.

**Validation rules**:
- `dir` must be an absolute path to an existing directory
- `dir` must contain a `tasks.md` file (spec-kit format)
- `name` must be non-empty, max 100 characters
- `id` must be unique across all projects

**Relationships**:
- A project has zero or one **active session** (enforced by FR-012)
- A project has zero or many **historical sessions**

---

### Session

A single agent process execution tied to a project.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID, generated on session start |
| `projectId` | `string` | References `Project.id` |
| `type` | `"interview" \| "task-run"` | Session type |
| `state` | `SessionState` | Current lifecycle state |
| `startedAt` | `string` | ISO 8601 timestamp |
| `endedAt` | `string \| null` | ISO 8601 timestamp, set on completion/failure |
| `pid` | `number \| null` | OS process ID of the agent, null when not running |
| `lastTaskId` | `string \| null` | Task ID the agent was working on (for crash recovery) |
| `question` | `string \| null` | Blocked-task question (set when state is `waiting-for-input`) |
| `exitCode` | `number \| null` | Agent process exit code (set on completion/failure) |

**State machine** (`SessionState`):

```
                    ┌──────────────┐
                    │   running    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
   ┌──────────────┐  ┌──────────┐  ┌────────┐
   │waiting-for-  │  │completed │  │ failed │
   │   input      │  └──────────┘  └────────┘
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐
   │   running    │  (same session resumes after input received)
   └──────────────┘
```

**Valid transitions**:
- `running` → `waiting-for-input` (agent marks task `[?]`)
- `running` → `completed` (all tasks done or interview finished)
- `running` → `failed` (process crashes or is killed)
- `waiting-for-input` → `running` (user provides answer → same session resumes, new agent process spawned)

**Storage**: `~/.agent-runner/sessions/<session-id>/meta.json`

**Validation rules**:
- `projectId` must reference an existing project
- `type` must be one of the two valid values
- `state` transitions must follow the state machine
- Only one session per project can be in `running` or `waiting-for-input` state

---

### Session Log Entry

A single line in the session's JSONL output log.

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `number` | Unix timestamp in milliseconds |
| `stream` | `"stdout" \| "stderr" \| "system"` | Output stream type |
| `seq` | `number` | Monotonically increasing sequence number (per session) |
| `content` | `string` | The output text |

**Storage**: `~/.agent-runner/sessions/<session-id>/output.jsonl` — append-only, one JSON object per line.

**`stream` values**:
- `stdout` — Agent process standard output
- `stderr` — Agent process standard error
- `system` — Server-generated events (session started, session completed, task detected, etc.)

**Validation rules**:
- `seq` must be strictly increasing within a session
- `ts` must be a positive integer
- `content` may be empty (e.g., blank lines from process output)

---

### Task (Read-Only, Parsed from Markdown)

A task item parsed from a project's markdown task file. **Not stored by the server** — derived on demand.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Hierarchical ID (e.g., `1.1`, `2.3.1`) |
| `phase` | `number` | Phase number extracted from section header |
| `phaseName` | `string` | Phase name from section header |
| `status` | `"unchecked" \| "checked" \| "blocked" \| "skipped"` | Parsed from checkbox marker |
| `description` | `string` | Task description text |
| `blockedReason` | `string \| null` | Question/reason (when status is `blocked`) |
| `depth` | `number` | Nesting level (0 = top-level, 1 = subtask, etc.) |

**Parsing rules**:
- `- [ ]` → `unchecked`
- `- [x]` → `checked`
- `- [?]` → `blocked`
- `- [~]` → `skipped`
- Description may contain ` — Done:`, ` — Blocked:`, or ` — Skipped:` suffixes
- Depth derived from leading whitespace (2 spaces per level)

---

### Task Summary (Derived)

An aggregated view of task progress for a project. **Computed, not stored.**

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total number of tasks |
| `completed` | `number` | Tasks with `[x]` status |
| `blocked` | `number` | Tasks with `[?]` status |
| `skipped` | `number` | Tasks with `[~]` status |
| `remaining` | `number` | Tasks with `[ ]` status |

---

### Push Subscription

A Web Push subscription for a connected client.

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | `string` | Push service URL |
| `keys` | `object` | `{ p256dh: string, auth: string }` |
| `createdAt` | `string` | ISO 8601 timestamp |

**Storage**: `~/.agent-runner/push-subscriptions.json` — JSON array.

---

## Filesystem Layout

```
~/.agent-runner/
├── projects.json                    # Project registry (array of Project objects)
├── push-subscriptions.json          # Web Push subscriptions
├── vapid-keys.json                  # VAPID public/private key pair (generated once)
└── sessions/
    ├── <session-id-1>/
    │   ├── meta.json                # Session metadata (Session object)
    │   └── output.jsonl             # Append-only session output log
    ├── <session-id-2>/
    │   ├── meta.json
    │   └── output.jsonl
    └── ...
```

## Server Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_RUNNER_HOST` | `127.0.0.1` | Server bind address |
| `AGENT_RUNNER_PORT` | `3000` | Server listen port |
| `AGENT_RUNNER_DATA_DIR` | `~/.agent-runner` | Runtime data directory |
| `AGENT_RUNNER_PROJECTS_DIR` | *(required)* | Base directory for new project creation |
| `LOG_LEVEL` | `info` | Operational log level (debug/info/warn/error/fatal) |
| `VAPID_PUBLIC_KEY` | *(auto-generated)* | VAPID public key for Web Push (overrides vapid-keys.json) |
| `VAPID_PRIVATE_KEY` | *(auto-generated)* | VAPID private key for Web Push (overrides vapid-keys.json) |
| `VAPID_SUBJECT` | `mailto:agent-runner@localhost` | VAPID subject for Web Push |
| `ALLOW_UNSANDBOXED` | `false` | Server-level gate for unsandboxed execution |
| `GOOGLE_STT_API_KEY` | *(none)* | Google Speech-to-Text API key (enables cloud voice transcription) |

**VAPID key resolution**: If `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars are set, they take precedence. Otherwise, the server reads from `~/.agent-runner/vapid-keys.json`. If neither exists, keys are auto-generated and written to `vapid-keys.json` on first startup.
