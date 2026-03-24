# WebSocket API Contract

**Branch**: `001-full-system-spec` | **Date**: 2026-03-24

All messages are JSON-encoded text frames.

## Session Stream: `/ws/sessions/:id`

### Connection

```
ws://host:port/ws/sessions/<session-id>?lastSeq=0
```

**Query params**:
- `lastSeq` (number, optional): Replay output entries with `seq > lastSeq`. Default `0` (replay all).

**Connection lifecycle**:
1. Client connects with optional `lastSeq`
2. Server sends `sync` message with current last sequence number
3. Server replays missed entries as `output` messages (if `lastSeq` < current)
4. Server streams live output as it arrives
5. Server sends periodic `ping` frames (30s interval); client must respond with `pong`
6. Server closes connection when session ends (after final state message)

### Server → Client Messages

#### output
```json
{
  "type": "output",
  "seq": 42,
  "ts": 1711238400000,
  "stream": "stdout",
  "content": "Working on T001: Initialize project..."
}
```
`stream`: `"stdout"` | `"stderr"` | `"system"`

#### state
```json
{
  "type": "state",
  "state": "waiting-for-input",
  "question": "What database engine should I use?",
  "taskId": "T003"
}
```

#### progress
```json
{
  "type": "progress",
  "taskSummary": {
    "total": 18,
    "checked": 14,
    "unchecked": 3,
    "blocked": 1,
    "skipped": 0
  }
}
```

#### phase
Spec-kit workflow phase transitions.
```json
{
  "type": "phase",
  "phase": "plan",
  "status": "started",
  "sessionId": "uuid"
}
```
`phase`: `"specify"` | `"clarify"` | `"plan"` | `"tasks"` | `"analyze"` | `"implement"`
`status`: `"started"` | `"completed"` | `"failed"`

#### ssh-agent-request
```json
{
  "type": "ssh-agent-request",
  "requestId": "uuid",
  "messageType": 13,
  "context": "Sign request for git push to github.com:user/repo.git",
  "data": "base64-encoded-request-data"
}
```
`messageType`: `11` (key listing) or `13` (sign request). Key listing (11) may be handled automatically by the client without user interaction.

#### sync
```json
{
  "type": "sync",
  "lastSeq": 42
}
```

#### error
```json
{
  "type": "error",
  "message": "Session not found"
}
```

### Client → Server Messages

#### input
Submit answer to a waiting-for-input session.
```json
{
  "type": "input",
  "text": "Use PostgreSQL"
}
```

#### ssh-agent-response
```json
{
  "type": "ssh-agent-response",
  "requestId": "uuid",
  "data": "base64-encoded-signed-response"
}
```

#### ssh-agent-cancel
```json
{
  "type": "ssh-agent-cancel",
  "requestId": "uuid"
}
```

### Backpressure

- Server buffers up to 64KB per client connection
- If buffer exceeds limit, oldest messages are dropped
- Client should process messages promptly to avoid drops

---

## Dashboard Stream: `/ws/dashboard`

### Connection

```
ws://host:port/ws/dashboard
```

No query params. Receives real-time updates about all projects and sessions.

### Server → Client Messages

#### project-update
Sent when any project's state changes (session start/stop, task progress, status change).
```json
{
  "type": "project-update",
  "projectId": "uuid",
  "project": {
    "id": "uuid",
    "name": "my-project",
    "status": "active",
    "taskSummary": {
      "total": 18,
      "checked": 14,
      "unchecked": 3,
      "blocked": 1,
      "skipped": 0
    },
    "activeSession": {
      "id": "uuid",
      "type": "task-run",
      "state": "running"
    },
    "workflow": null
  }
}
```

#### onboarding-step
Sent during project onboarding pipeline.
```json
{
  "type": "onboarding-step",
  "projectId": "uuid",
  "step": "generate-flake",
  "status": "completed",
  "message": "Generated flake.nix for Node.js project"
}
```
`step`: `"register"` | `"create-directory"` | `"generate-flake"` | `"git-init"` | `"git-remote"` | `"install-specify"` | `"specify-init"` | `"launch-interview"`
`status`: `"started"` | `"completed"` | `"failed"` | `"skipped"`

#### error
```json
{
  "type": "error",
  "message": "Discovery scan failed"
}
```

### Client → Server Messages

No client-to-server messages on the dashboard WebSocket. It is a read-only stream.

---

## SSH Agent Bridge Protocol (Unix Socket)

This is the binary protocol between the sandboxed agent process and the server, over the Unix socket at `SSH_AUTH_SOCK`.

### Wire Format

All messages are length-prefixed:
```
[4 bytes: message length (uint32 big-endian, excludes these 4 bytes)]
[1 byte: message type]
[N bytes: message payload]
```

### Supported Message Types

#### SSH_AGENTC_REQUEST_IDENTITIES (type 11)

Client → Server. No payload.

Response: `SSH_AGENT_IDENTITIES_ANSWER` (type 12):
```
[4 bytes: number of keys (uint32)]
For each key:
  [4 bytes: key blob length (uint32)]
  [N bytes: key blob]
  [4 bytes: comment length (uint32)]
  [N bytes: comment string]
```

#### SSH_AGENTC_SIGN_REQUEST (type 13)

Client → Server:
```
[4 bytes: key blob length (uint32)]
[N bytes: key blob]
[4 bytes: data length (uint32)]
[N bytes: data to sign]
[4 bytes: flags (uint32)]
```

Response: `SSH_AGENT_SIGN_RESPONSE` (type 14):
```
[4 bytes: signature blob length (uint32)]
[N bytes: signature blob]
```

#### All Other Types

Server responds with `SSH_AGENT_FAILURE` (type 5), no payload.

### Relay Flow

```
Agent Process          Unix Socket           Server              WebSocket          Client
    │                      │                    │                    │                 │
    │── SSH_AGENTC_SIGN ──▶│                    │                    │                 │
    │   REQUEST (type 13)  │── parse binary ───▶│                    │                 │
    │                      │                    │── ssh-agent-req ──▶│                 │
    │                      │                    │   (JSON+base64)    │── show modal ──▶│
    │                      │                    │                    │                 │
    │                      │                    │                    │◀── user touch ──│
    │                      │                    │◀── ssh-agent-resp ─│   Yubikey       │
    │                      │◀── binary resp ────│   (JSON+base64)    │                 │
    │◀── SSH_AGENT_SIGN ───│                    │                    │                 │
    │   RESPONSE (type 14) │                    │                    │                 │
```

### Timeout

If no client responds within 60 seconds, server returns `SSH_AGENT_FAILURE` (type 5) to the agent process.
