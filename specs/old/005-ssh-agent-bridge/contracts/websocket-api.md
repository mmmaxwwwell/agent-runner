# WebSocket API Contract: SSH Agent Bridge

## New Message Types on `/ws/sessions/:id`

### Server → Client: SSH Agent Request

Sent when a sandboxed agent process makes an SSH agent protocol request (key listing or signing).

```json
{
  "type": "ssh-agent-request",
  "requestId": "uuid-v4",
  "messageType": 11,
  "context": "List SSH keys for git push to github.com:user/repo.git",
  "data": "base64-encoded-ssh-agent-message-bytes"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ssh-agent-request"` | Message type identifier |
| `requestId` | string (UUID) | Unique ID for correlating response |
| `messageType` | `11 \| 13` | SSH agent message type (11 = list keys, 13 = sign) |
| `context` | string | Human-readable description of the operation |
| `data` | string | Base64-encoded raw SSH agent protocol message bytes (excluding 4-byte length prefix) |

**Context format examples:**
- `"List SSH keys for git push to github.com:user/repo.git"`
- `"Sign for git push to github.com:user/repo.git (user: git, algo: ecdsa-sha2-nistp256)"`
- `"SSH sign request from sandboxed agent"` (fallback when remote context unavailable)

### Client → Server: SSH Agent Response

Sent by the client after the user authorizes the operation (e.g., Yubikey touch).

```json
{
  "type": "ssh-agent-response",
  "requestId": "uuid-v4",
  "data": "base64-encoded-ssh-agent-response-bytes"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ssh-agent-response"` | Message type identifier |
| `requestId` | string (UUID) | Must match a pending request |
| `data` | string | Base64-encoded raw SSH agent protocol response bytes (excluding 4-byte length prefix) |

### Client → Server: SSH Agent Cancel

Sent by the client when the user cancels the operation.

```json
{
  "type": "ssh-agent-cancel",
  "requestId": "uuid-v4"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ssh-agent-cancel"` | Message type identifier |
| `requestId` | string (UUID) | Must match a pending request |

## Error Handling

- If `requestId` doesn't match a pending request → message is silently dropped
- If response arrives after timeout (60s) → message is silently dropped (socket already received FAILURE)
- If no client is connected when a request arrives → SSH_AGENT_FAILURE returned to Unix socket immediately
