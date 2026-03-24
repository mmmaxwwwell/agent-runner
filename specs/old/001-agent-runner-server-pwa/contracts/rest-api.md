# REST API Contract: Agent Runner Server

**Base URL**: `http://{AGENT_RUNNER_HOST}:{AGENT_RUNNER_PORT}/api`

All responses are JSON. Errors use `{"error": "message"}` format with appropriate HTTP status codes.

---

## Projects

### `GET /api/projects`

List all registered projects with task summaries.

**Response** `200`:
```json
[
  {
    "id": "uuid",
    "name": "my-project",
    "dir": "/home/user/projects/my-project",
    "taskFile": "my-project-tasks.md",
    "promptFile": "my-project-prompt.md",
    "createdAt": "2026-03-22T10:00:00Z",
    "taskSummary": {
      "total": 18,
      "completed": 14,
      "blocked": 1,
      "skipped": 0,
      "remaining": 3
    },
    "activeSession": {
      "id": "uuid",
      "type": "task-run",
      "state": "running",
      "startedAt": "2026-03-22T10:30:00Z"
    }
  }
]
```

`activeSession` is `null` if no session is running or waiting.

---

### `POST /api/projects`

Register a new project.

**Request**:
```json
{
  "name": "my-project",
  "dir": "/home/user/projects/my-project"
}
```

**Response** `201`:
```json
{
  "id": "uuid",
  "name": "my-project",
  "dir": "/home/user/projects/my-project",
  "taskFile": "my-project-tasks.md",
  "promptFile": "my-project-prompt.md",
  "createdAt": "2026-03-22T10:00:00Z"
}
```

**Errors**:
- `400` — Invalid or missing fields
- `400` — Directory does not exist
- `400` — No `tasks.md` file found in directory
- `409` — Project with same directory already registered

**Notes**: `taskFile` defaults to `tasks.md`. `promptFile` is auto-detected by scanning for spec-kit artifacts.

---

### `GET /api/projects/:id`

Get a single project with full task list.

**Response** `200`:
```json
{
  "id": "uuid",
  "name": "my-project",
  "dir": "/home/user/projects/my-project",
  "taskFile": "my-project-tasks.md",
  "promptFile": "my-project-prompt.md",
  "createdAt": "2026-03-22T10:00:00Z",
  "taskSummary": { "total": 18, "completed": 14, "blocked": 1, "skipped": 0, "remaining": 3 },
  "tasks": [
    {
      "id": "1.1",
      "phase": 1,
      "phaseName": "Setup",
      "status": "checked",
      "description": "Initialize Node.js project",
      "blockedReason": null,
      "depth": 0
    }
  ],
  "activeSession": null,
  "sessions": [
    {
      "id": "uuid",
      "type": "task-run",
      "state": "completed",
      "startedAt": "2026-03-22T10:30:00Z",
      "endedAt": "2026-03-22T11:00:00Z"
    }
  ]
}
```

**Errors**:
- `404` — Project not found

---

### `DELETE /api/projects/:id`

Unregister a project. Does not delete project files.

**Response** `204` (no body)

**Errors**:
- `404` — Project not found
- `409` — Project has an active session (must stop it first)

---

## Spec-Kit Workflow

### `POST /api/projects/:id/add-feature`

Start the spec-kit SDD workflow to add a new feature to an existing project. This triggers the same workflow orchestration as new project creation (specify → clarify → plan → tasks → analyze loop), but operates on the existing project directory.

**Request**:
```json
{
  "description": "Add user authentication with OAuth2 support",
  "allowUnsandboxed": false
}
```

`description` is the natural-language feature description (text or transcribed voice). `allowUnsandboxed` follows the same rules as session creation.

**Response** `201`:
```json
{
  "sessionId": "uuid",
  "projectId": "uuid",
  "phase": "specify",
  "state": "running"
}
```

The response returns the first session (specify phase). Subsequent phases auto-advance on completion — the client tracks progress via the dashboard WebSocket or by polling sessions.

**Errors**:
- `404` — Project not found
- `409` — Project already has an active session
- `400` — Empty description
- `503` — Sandboxing unavailable and not overridden

---

## Sessions

### `POST /api/projects/:id/sessions`

Start a new session for a project.

**Request**:
```json
{
  "type": "task-run",
  "allowUnsandboxed": false
}
```

Valid types: `"task-run"`, `"interview"`.

`allowUnsandboxed` is optional (defaults to `false`). Only effective when the server was started with `ALLOW_UNSANDBOXED=true` env var. If sandbox is unavailable and either gate is missing, returns `503`.

**Response** `201`:
```json
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "task-run",
  "state": "running",
  "startedAt": "2026-03-22T10:30:00Z",
  "pid": 12345
}
```

**Errors**:
- `404` — Project not found
- `409` — Project already has an active session
- `400` — No unchecked tasks remaining (for task-run type)
- `400` — `allowUnsandboxed` requested but server `ALLOW_UNSANDBOXED` env var not set
- `503` — Sandboxing unavailable and not overridden

---

### `GET /api/projects/:id/sessions`

List all sessions for a project (most recent first).

**Response** `200`:
```json
[
  {
    "id": "uuid",
    "type": "task-run",
    "state": "completed",
    "startedAt": "2026-03-22T10:30:00Z",
    "endedAt": "2026-03-22T11:00:00Z",
    "exitCode": 0
  }
]
```

---

### `GET /api/sessions/:id`

Get session details including metadata.

**Response** `200`:
```json
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "task-run",
  "state": "waiting-for-input",
  "startedAt": "2026-03-22T10:30:00Z",
  "endedAt": null,
  "pid": null,
  "question": "What API key should I use for the payment provider?",
  "lastTaskId": "2.3"
}
```

**Errors**:
- `404` — Session not found

---

### `POST /api/sessions/:id/input`

Submit user input to a blocked session. The same session transitions back to `running` and re-spawns the agent process with the clarification.

**Request**:
```json
{
  "answer": "Use the Stripe test key: sk_test_..."
}
```

**Response** `200`:
```json
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "task-run",
  "state": "running",
  "startedAt": "2026-03-22T10:30:00Z",
  "pid": 12346
}
```

**Errors**:
- `404` — Session not found
- `400` — Session is not in `waiting-for-input` state
- `400` — Empty answer

---

### `POST /api/sessions/:id/stop`

Stop a running session.

**Response** `200`:
```json
{
  "id": "uuid",
  "state": "failed",
  "endedAt": "2026-03-22T11:10:00Z",
  "exitCode": -1
}
```

**Errors**:
- `404` — Session not found
- `400` — Session is not in `running` state

---

### `GET /api/sessions/:id/log`

Get the full session log (JSONL as JSON array).

**Query params**:
- `afterSeq` (optional) — Return only entries with `seq > afterSeq` (for replay)

**Response** `200`:
```json
[
  {"ts": 1711100000000, "stream": "system", "seq": 1, "content": "Session started"},
  {"ts": 1711100001000, "stream": "stdout", "seq": 2, "content": "Working on task 1.1..."}
]
```

---

## Push Notifications

### `POST /api/push/subscribe`

Register a push subscription.

**Request**:
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

**Response** `201` (no body)

---

### `GET /api/push/vapid-key`

Get the VAPID public key for client-side subscription.

**Response** `200`:
```json
{
  "publicKey": "BEl62i..."
}
```

---

## Voice

### `POST /api/voice/transcribe`

Transcribe audio via Google Speech-to-Text API.

**Request**: `multipart/form-data` with `audio` field (audio blob).

**Response** `200`:
```json
{
  "text": "Transcribed text from the audio"
}
```

**Errors**:
- `503` — Google STT not configured (`GOOGLE_STT_API_KEY` not set)
- `400` — No audio provided
- `502` — Google STT API error

---

## Server

### `GET /api/health`

Health check.

**Response** `200`:
```json
{
  "status": "ok",
  "uptime": 3600,
  "sandboxAvailable": true,
  "cloudSttAvailable": true
}
```

---

### `PUT /api/config/log-level`

Change the runtime log level.

**Request**:
```json
{
  "level": "debug"
}
```

**Response** `200`:
```json
{
  "level": "debug"
}
```

Valid levels: `debug`, `info`, `warn`, `error`, `fatal`.
