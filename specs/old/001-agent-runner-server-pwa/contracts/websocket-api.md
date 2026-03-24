# WebSocket API Contract: Agent Runner Server

**Library**: `ws` (raw WebSocket, no Socket.IO)

## Connection

### Session Stream

**URL**: `ws://{host}:{port}/ws/sessions/{sessionId}?lastSeq={N}`

Connect to stream a session's output in real time.

**Query parameters**:
- `lastSeq` (optional) — Sequence number of last received message. Server replays all entries with `seq > lastSeq` before switching to live streaming. Omit for full replay from start.

**Connection flow**:
1. Client connects to `/ws/sessions/:id`
2. If `lastSeq` provided, server replays missed entries from JSONL log
3. Server sends a `sync` message indicating replay is complete
4. Server streams live output as it arrives
5. Server sends `ping` frames every 30 seconds; client auto-responds with `pong`

---

## Server → Client Messages

All messages are JSON with a `type` field.

### `output`

Agent process output (stdout/stderr/system event).

```json
{
  "type": "output",
  "seq": 42,
  "ts": 1711100000000,
  "stream": "stdout",
  "content": "Working on task 1.1..."
}
```

- `seq`: Monotonically increasing per session. Used for replay tracking.
- `stream`: `"stdout"` | `"stderr"` | `"system"`

### `state`

Session state change.

```json
{
  "type": "state",
  "state": "waiting-for-input",
  "question": "What API key should I use?",
  "taskId": "2.3"
}
```

Emitted when session transitions between states.

### `progress`

Task progress update (emitted when task file changes are detected).

```json
{
  "type": "progress",
  "taskSummary": {
    "total": 18,
    "completed": 15,
    "blocked": 0,
    "skipped": 0,
    "remaining": 3
  }
}
```

### `sync`

Replay complete, switching to live streaming.

```json
{
  "type": "sync",
  "lastSeq": 142
}
```

Sent after all replay entries have been delivered. Client can use `lastSeq` to verify continuity.

### `phase`

Spec-kit workflow phase transition (emitted during new-project and add-feature workflows).

```json
{
  "type": "phase",
  "workflow": "add-feature",
  "phase": "clarify",
  "previousPhase": "specify",
  "iteration": 1,
  "maxIterations": 5,
  "sessionId": "uuid"
}
```

- `workflow`: `"new-project"` or `"add-feature"`
- `phase`: Current phase — `"specify"`, `"clarify"`, `"plan"`, `"tasks"`, `"analyze"`, `"implementation"`
- `previousPhase`: The phase that just completed (null for the first phase)
- `iteration`: For the analyze phase, the current loop iteration (1-5). For other phases, always 1.
- `maxIterations`: For the analyze phase, the maximum iterations (5). For other phases, always 1.
- `sessionId`: The new session ID for the current phase

### `error`

Server-side error related to this session.

```json
{
  "type": "error",
  "message": "Agent process crashed with exit code 1"
}
```

---

## Client → Server Messages

### `input`

Submit user input to an interview session.

```json
{
  "type": "input",
  "content": "Use the Stripe test key"
}
```

Only valid for `interview` type sessions in `running` state. For `task-run` sessions waiting for input, use the REST endpoint `POST /api/sessions/:id/input` instead (which resumes the same session with a new agent process).

---

## Dashboard Stream

**URL**: `ws://{host}:{port}/ws/dashboard`

Real-time updates for the project dashboard.

### `project-update`

Emitted when any project's state changes.

```json
{
  "type": "project-update",
  "projectId": "uuid",
  "activeSession": {
    "id": "uuid",
    "type": "interview",
    "state": "running"
  },
  "taskSummary": {
    "total": 18,
    "completed": 15,
    "blocked": 0,
    "skipped": 0,
    "remaining": 3
  },
  "workflow": {
    "type": "add-feature",
    "phase": "clarify",
    "iteration": 1,
    "description": "Add user authentication with OAuth2"
  }
}
```

`activeSession` is `null` when no session is active. `workflow` is `null` when no spec-kit workflow is in progress. When present, `workflow.type` is `"new-project"` or `"add-feature"`, `workflow.phase` is the current SDD phase, and `workflow.description` is the feature description provided by the user.

---

## Heartbeat

- Server sends WebSocket protocol-level `ping` frames every 30 seconds
- Clients (browsers) auto-respond with `pong` per RFC 6455
- Server marks connection dead after 3 consecutive missed pongs (90 seconds)
- Dead connections are cleaned up (removed from broadcast sets)

## Backpressure

- Server checks `ws.bufferedAmount` before sending to each client
- If buffered data exceeds 64KB, messages are dropped for that client (with a `system` log entry)
- This prevents a slow client from blocking the server or consuming unbounded memory
