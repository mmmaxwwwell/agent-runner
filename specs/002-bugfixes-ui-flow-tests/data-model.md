# Data Model: Bugfixes, UI Flow Documentation, and Integration Tests

This feature introduces no new entities or data model changes. It fixes bugs in existing code paths and adds documentation + tests.

## Existing Entities Referenced

### Project (unchanged)
- `id`: UUID
- `name`: string (unique, filesystem-safe)
- `dir`: string (absolute path)
- `taskFile`: string (default: `tasks.md`)
- `promptFile`: string (auto-detected)
- `createdAt`: ISO 8601 timestamp

**Storage**: `~/.agent-runner/projects.json`

### Session (unchanged)
- `id`: UUID
- `projectId`: UUID (foreign key → Project)
- `type`: `"task-run"` | `"interview"`
- `state`: `"running"` | `"waiting-for-input"` | `"completed"` | `"failed"`
- `startedAt`: ISO 8601 timestamp
- `endedAt`: ISO 8601 timestamp | null
- `pid`: number | null
- `lastTaskId`: string | null
- `question`: string | null
- `exitCode`: number | null

**State transitions**:
```
running → waiting-for-input  (agent asks question)
running → completed          (process exits 0)
running → failed             (process exits non-0, or stopped)
waiting-for-input → running  (user submits input)
```

**Storage**: `~/.agent-runner/sessions/{id}/meta.json`

## New Request/Response Shapes

### POST /api/workflows/new-project

**Request body**:
```typescript
{
  name: string;          // Required, non-empty, filesystem-safe chars only
  description: string;   // Required, non-empty
  allowUnsandboxed?: boolean;  // Optional, default false
}
```

**Validation rules**:
- `name`: trim, must be non-empty, must match `/^[a-zA-Z0-9._-]+$/` (filesystem-safe), must not already exist as a project or directory
- `description`: trim, must be non-empty

**Success response** (201):
```typescript
{
  sessionId: string;   // UUID of first session (specify phase)
  projectId: string;   // UUID placeholder (real ID assigned after workflow completes)
  phase: "specify";
  state: "running";
}
```

**Error responses**: 400 (validation), 409 (duplicate name), 503 (sandbox unavailable)

## Voice Module State Model (updated behavior, same types)

```typescript
type VoiceState = 'idle' | 'listening' | 'processing';
```

**New behavioral contract for browser backend**:
- `listening` state persists across speech pauses (continuous mode)
- Interim results emitted during `listening` state
- Transitions to `processing` only on explicit stop or silence timeout
- Silence timeout: 5000ms of no speech results
