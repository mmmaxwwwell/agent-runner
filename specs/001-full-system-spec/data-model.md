# Data Model: Agent Runner Full System

**Branch**: `001-full-system-spec` | **Date**: 2026-03-24

## Entity Relationship Diagram

```
┌──────────────┐ 1     * ┌──────────────┐ 1     1 ┌──────────────────┐
│   Project    │────────▶│   Session    │────────▶│  SessionLog      │
│              │         │              │         │  (output.jsonl)  │
└──────┬───────┘         └──────┬───────┘         └──────────────────┘
       │                        │
       │ 1     *                │ 0..1   0..1
       ▼                        ▼
┌──────────────┐         ┌──────────────────┐
│    Task      │         │  SSHAgentBridge  │
│ (parsed from │         │  (Unix socket)   │
│  tasks.md)   │         └──────────────────┘
└──────────────┘

┌──────────────────┐     ┌──────────────────┐
│ DiscoveredDir    │     │ AgentFramework   │
│ (runtime, not    │     │ (managed clone)  │
│  persisted)      │     └──────────────────┘
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐
│ PushSubscription │     │  ServerConfig    │
│ (push-subs.json) │     │  (Android only)  │
└──────────────────┘     └──────────────────┘
```

## Entities

### Project

**Storage**: `<dataDir>/projects.json` (JSON array)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID v4) | yes | Unique identifier |
| name | string | yes | Human-readable project name |
| description | string \| null | no | Agent-generated summary after interview |
| dir | string | yes | Absolute path to project directory |
| taskFile | string | yes | Relative path to tasks.md within project |
| promptFile | string | yes | Relative path to prompt file within project |
| createdAt | string (ISO 8601) | yes | Registration timestamp |
| status | enum | yes | `"active"` \| `"onboarding"` \| `"error"` |

**State transitions**:
```
                  ┌─────────────┐
    register ───▶ │ onboarding  │
                  └──────┬──────┘
                         │ interview completes + user signals readiness
                         ▼
                  ┌─────────────┐
                  │   active    │◀──── error recovery
                  └──────┬──────┘
                         │ unrecoverable error
                         ▼
                  ┌─────────────┐
                  │    error    │
                  └─────────────┘
```

**Validation rules**:
- `name`: 1-100 chars, alphanumeric + hyphens + underscores, no leading/trailing hyphens
- `dir`: must be absolute path, must exist on disk (or will be created for new projects)
- `taskFile`: default `tasks.md`, must exist for task-run sessions
- No duplicate `dir` values across projects

**Relationships**:
- Has many Sessions (0..*)
- Has at most one active Session (concurrent prevention)
- Has many Tasks (parsed on-demand from taskFile, not stored)

### Session

**Storage**: `<dataDir>/sessions/<id>/meta.json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID v4) | yes | Unique identifier |
| projectId | string | yes | FK to Project |
| type | enum | yes | `"interview"` \| `"task-run"` |
| state | enum | yes | `"running"` \| `"waiting-for-input"` \| `"completed"` \| `"failed"` |
| startedAt | string (ISO 8601) | yes | Session start time |
| endedAt | string \| null | no | Session end time |
| pid | number \| null | no | OS process ID of agent |
| lastTaskId | string \| null | no | Last task being worked on (task-run only) |
| question | string \| null | no | Blocked task question (waiting-for-input only) |
| exitCode | number \| null | no | Process exit code |

**State transitions**:
```
              ┌───────────┐
  create ───▶ │  running   │◀──── input received (from waiting-for-input)
              └─────┬──────┘
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
  ┌──────────┐ ┌─────────┐ ┌────────┐
  │completed │ │waiting-  │ │ failed │
  │          │ │for-input │ │        │
  └──────────┘ └──────────┘ └────────┘
```

**Valid transitions**:
- `running` → `completed` (all tasks done or clean exit)
- `running` → `waiting-for-input` (agent marks task `[?]`)
- `running` → `failed` (process crash, user stop, error)
- `waiting-for-input` → `running` (user submits answer)

**Constraints**:
- Only one session per project may be in `running` or `waiting-for-input` state
- `endedAt` set when transitioning to `completed` or `failed`
- `pid` cleared when process exits
- `question` set only when `state === "waiting-for-input"`

### Task

**Storage**: Not persisted by the system. Parsed on-demand from project's `tasks.md`.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Generated from phase + index (e.g., `T001`) |
| phase | number | Phase number (0-based) |
| phaseName | string | Phase heading text |
| status | enum | `"unchecked"` \| `"checked"` \| `"blocked"` \| `"skipped"` |
| description | string | Task description text |
| blockedReason | string \| null | Question text when status is `blocked` |
| depth | number | Nesting depth (0 = top-level task) |

**Markdown format**:
```markdown
## Phase 1: Setup
- [x] T001: Initialize project structure
- [ ] T002: Configure build system
- [?] T003: Set up database (What DB engine?)
- [~] T004: Optional migration step
```

**Status mapping**:
- `- [ ]` → `unchecked`
- `- [x]` → `checked`
- `- [?]` → `blocked` (blockedReason extracted from parenthetical or following text)
- `- [~]` → `skipped`

### SessionLog (output.jsonl)

**Storage**: `<dataDir>/sessions/<id>/output.jsonl` (append-only JSONL)

| Field | Type | Description |
|-------|------|-------------|
| seq | number | Monotonically increasing sequence number |
| ts | number | Unix timestamp (milliseconds) |
| stream | enum | `"stdout"` \| `"stderr"` \| `"system"` |
| content | string | Output content |

**Properties**:
- Append-only, survives restarts and disconnections
- `seq` enables replay from any point (client sends `lastSeq` on reconnect)
- `system` stream used for lifecycle events (session start, stop, phase transitions)
- One file per session, never truncated

### DiscoveredDirectory

**Storage**: Not persisted. Computed at runtime by scanning `projectsDir`.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Directory name |
| path | string | Absolute path |
| isGitRepo | boolean | Has `.git/` directory |
| hasNixFlake | boolean | Has `flake.nix` |
| hasSpecKit | boolean | Has `.specify/` directory |

**Discovery rules**:
- Scan only top-level, non-hidden entries in `projectsDir` (default `~/git`)
- Exclude entries that match a registered project's `dir`
- No recursive scanning
- Refresh on dashboard page load only

### AgentFramework

**Storage**: `<dataDir>/agent-framework/` (git clone)

**Lifecycle**:
- Cloned on server startup if missing (`git clone`)
- Updated on startup and before each session launch (`git pull`)
- Mounted read-only into sandbox via `BindReadOnlyPaths`
- Contains: skill files, interview wrapper, run-tasks script

### SSHAgentBridge

**Storage**: Unix socket at `<dataDir>/sessions/<sessionId>/agent.sock`

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Owning session |
| socketPath | string | Absolute path to Unix socket |
| server | net.Server | Node.js Unix socket server |

**Lifecycle**:
- Created when session starts AND project has SSH git remote
- Socket path injected into sandbox via `BindPaths` and `SSH_AUTH_SOCK`
- Cleaned up when session ends
- Stale sockets removed before creating new ones

### SSHAgentRequest

**Storage**: In-memory (pending request map)

| Field | Type | Description |
|-------|------|-------------|
| requestId | string (UUID v4) | Correlation ID |
| messageType | number | 11 (identities) or 13 (sign) |
| context | string | Human-readable description of operation |
| data | string | Base64-encoded binary request data |

### SSHAgentResponse

**Storage**: In-memory

| Field | Type | Description |
|-------|------|-------------|
| requestId | string | Correlation ID matching request |
| data | string \| undefined | Base64-encoded signed response |
| cancelled | boolean \| undefined | True if user cancelled |

### PushSubscription

**Storage**: `<dataDir>/push-subscriptions.json` (JSON array)

| Field | Type | Description |
|-------|------|-------------|
| endpoint | string | Push service URL (unique key) |
| keys.p256dh | string | Client public key |
| keys.auth | string | Authentication secret |

### Transcript

**Storage**: `specs/<name>/transcript.md` (append-only markdown)

**Format**:
```markdown
## User
User's message text

## Agent
Agent's response text (tool calls omitted)
```

**Properties**:
- Generated in real-time by server-side parser watching `output.jsonl`
- Append-only for crash safety
- Only conversational text; tool calls summarized or omitted

### InterviewNotes

**Storage**: `specs/<name>/interview-notes.md`

**Written by**: Claude agent at end of interview when user signals readiness.
**Purpose**: Handoff document for downstream planning phases.

### ServerConfig (Android)

**Storage**: Android SharedPreferences

| Field | Type | Description |
|-------|------|-------------|
| serverUrl | string | Base URL of agent-runner server |

### YubikeyManager (Android)

**In-memory state**:

| Field | Type | Description |
|-------|------|-------------|
| isConnected | boolean | Whether a Yubikey is currently detected |
| connectionType | enum | `"usb"` \| `"nfc"` \| null |
| cachedPin | string \| null | PIN cached in memory only |
| pendingRequests | Queue | Queued sign requests |

## File System Layout

```
~/.local/share/agent-runner/          # AGENT_RUNNER_DATA_DIR
├── projects.json                      # Project registry
├── push-subscriptions.json            # Push notification subscriptions
├── vapid-public.pem                   # VAPID public key
├── vapid-private.pem                  # VAPID private key
├── agent-framework/                   # Managed git clone
│   └── .claude/skills/...            # Skill files (read-only in sandbox)
└── sessions/
    └── <session-id>/
        ├── meta.json                  # Session metadata
        ├── output.jsonl               # Append-only output log
        └── agent.sock                 # SSH agent bridge socket (if applicable)

~/git/                                 # AGENT_RUNNER_PROJECTS_DIR (default)
├── project-a/                         # Registered project
│   ├── flake.nix
│   ├── .specify/
│   ├── specs/
│   │   └── 001-feature/
│   │       ├── spec.md
│   │       ├── transcript.md
│   │       ├── interview-notes.md
│   │       ├── plan.md
│   │       └── tasks.md
│   └── src/
└── project-b/                         # Discovered (unregistered) directory
    └── package.json
```
