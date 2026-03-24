# REST API Contract

**Branch**: `001-full-system-spec` | **Date**: 2026-03-24

All endpoints accept/return JSON. Base path: `/api`.

## Health & Config

### GET /api/health

**Response** `200`:
```json
{
  "status": "ok",
  "uptime": 12345,
  "sandboxAvailable": true,
  "cloudSttAvailable": false
}
```

### PUT /api/config/log-level

**Request**:
```json
{ "level": "debug" }
```
Valid levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`

**Response** `200`:
```json
{ "level": "debug" }
```

**Error** `400`: Invalid level

---

## Projects

### GET /api/projects

Returns both registered projects and discovered directories.

**Response** `200`:
```json
{
  "registered": [
    {
      "id": "uuid",
      "name": "my-project",
      "description": "A project description",
      "dir": "/home/user/git/my-project",
      "taskFile": "tasks.md",
      "promptFile": "prompt.md",
      "createdAt": "2026-03-24T00:00:00.000Z",
      "status": "active"
    }
  ],
  "discovered": [
    {
      "name": "new-dir",
      "path": "/home/user/git/new-dir",
      "isGitRepo": true,
      "hasNixFlake": false,
      "hasSpecKit": false
    }
  ],
  "discoveryError": null
}
```

### POST /api/projects

Register an existing project.

**Request**:
```json
{
  "name": "my-project",
  "dir": "/home/user/git/my-project"
}
```

**Response** `201`:
```json
{
  "projectId": "uuid",
  "name": "my-project",
  "dir": "/home/user/git/my-project",
  "status": "active"
}
```

**Errors**:
- `400`: Missing name or dir, invalid name, tasks.md not found
- `409`: Directory already registered

### GET /api/projects/:id

**Response** `200`:
```json
{
  "project": { "...Project fields..." },
  "taskSummary": {
    "total": 18,
    "checked": 14,
    "unchecked": 3,
    "blocked": 1,
    "skipped": 0
  },
  "activeSession": { "...Session fields or null..." },
  "sessions": [ "...Session[]..." ]
}
```

**Error** `404`: Project not found

### DELETE /api/projects/:id

**Response** `204`: No content

**Error** `404`: Project not found

### GET /api/projects/:id/sessions

**Response** `200`:
```json
[
  {
    "id": "uuid",
    "projectId": "uuid",
    "type": "task-run",
    "state": "completed",
    "startedAt": "2026-03-24T00:00:00.000Z",
    "endedAt": "2026-03-24T01:00:00.000Z",
    "pid": null,
    "lastTaskId": "T018",
    "question": null,
    "exitCode": 0
  }
]
```

### POST /api/projects/:id/sessions

Start a new session (interview or task-run).

**Request**:
```json
{
  "type": "task-run",
  "allowUnsandboxed": false
}
```

**Response** `201`:
```json
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "task-run",
  "state": "running",
  "startedAt": "2026-03-24T00:00:00.000Z",
  "pid": 12345
}
```

**Errors**:
- `400`: Invalid type, missing required fields
- `404`: Project not found
- `409`: Active session already exists for this project

### POST /api/projects/:id/add-feature

Launch add-feature SDD workflow.

**Request**:
```json
{
  "description": "Add dark mode support"
}
```

**Response** `201`:
```json
{
  "projectId": "uuid",
  "sessionId": "uuid",
  "workflow": "add-feature",
  "phase": "specify"
}
```

**Errors**:
- `400`: Missing description
- `404`: Project not found
- `409`: Active session exists

---

## Onboarding & New Project

### POST /api/projects/onboard

Unified flow for onboarding discovered directories and creating new projects.

**Request** (onboard existing):
```json
{
  "path": "/home/user/git/existing-dir",
  "gitRemoteUrl": "git@github.com:user/repo.git"
}
```

**Request** (new project):
```json
{
  "name": "new-project",
  "gitRemoteUrl": "git@github.com:user/repo.git"
}
```

**Response** `201`:
```json
{
  "projectId": "uuid",
  "sessionId": "uuid",
  "status": "onboarding"
}
```

**Errors**:
- `400`: Missing name/path, invalid name, path not a directory
- `409`: Already registered

### POST /api/workflows/new-project

Alias for `POST /api/projects/onboard` with `name` field. Same behavior.

---

## Sessions

### GET /api/sessions/:id

**Response** `200`: Session object (see schema above)

**Error** `404`: Session not found

### GET /api/sessions/:id/log

**Query params**:
- `after` (number, optional): Return entries with `seq > after`
- `limit` (number, optional): Max entries to return

**Response** `200`:
```json
{
  "entries": [
    {
      "seq": 1,
      "ts": 1711238400000,
      "stream": "stdout",
      "content": "Starting task T001..."
    }
  ]
}
```

### POST /api/sessions/:id/stop

**Response** `200`:
```json
{
  "state": "failed",
  "endedAt": "2026-03-24T01:00:00.000Z"
}
```

**Errors**:
- `404`: Session not found
- `409`: Session not in stoppable state (already completed/failed)

### POST /api/sessions/:id/input

Submit answer to a blocked task.

**Request**:
```json
{
  "text": "Use PostgreSQL for the database"
}
```

**Response** `200`:
```json
{
  "state": "running"
}
```

**Errors**:
- `400`: Missing text
- `404`: Session not found
- `409`: Session not in waiting-for-input state

### POST /api/sessions/:id/ssh-response

Submit SSH agent sign response from client.

**Request**:
```json
{
  "requestId": "uuid",
  "data": "base64-encoded-signed-response"
}
```

Or cancel:
```json
{
  "requestId": "uuid",
  "cancelled": true
}
```

**Response** `200`:
```json
{ "status": "ok" }
```

**Errors**:
- `400`: Missing requestId
- `404`: Session or request not found

---

## Push Notifications

### POST /api/push/subscribe

**Request**:
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": {
    "p256dh": "base64",
    "auth": "base64"
  }
}
```

**Response** `200`:
```json
{ "status": "ok" }
```

### GET /api/push/vapid-key

**Response** `200`:
```json
{
  "publicKey": "base64-encoded-vapid-public-key"
}
```

---

## Voice Transcription

### POST /api/voice/transcribe

**Request**: `multipart/form-data` or raw audio bytes with `Content-Type: audio/webm` (or similar)

**Response** `200`:
```json
{
  "text": "transcribed text here"
}
```

**Errors**:
- `400`: No audio data
- `503`: Google STT API key not configured

### GET /api/voice/status

**Response** `200`:
```json
{
  "available": true
}
```
