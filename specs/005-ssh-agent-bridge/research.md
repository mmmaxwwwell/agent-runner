# Research: SSH Agent WebSocket Bridge

## Decision 1: SSH Agent Protocol Parsing Approach

**Decision**: Hand-written binary parser for the SSH agent protocol. Only parse message types 11 (REQUEST_IDENTITIES) and 13 (SIGN_REQUEST), plus responses 12, 14, and 5.

**Rationale**: The SSH agent protocol is minimal — 4-byte big-endian length prefix + 1-byte type + payload. Only 2 request types need handling. A dependency would add more complexity than the ~50 lines of parsing code.

**Alternatives considered**:
- `ssh2` npm package — too heavy, includes full SSH client/server
- `ssh-agent` npm package — unmaintained, adds unnecessary abstraction

## Decision 2: Binary Data Encoding Over WebSocket

**Decision**: Base64-encode SSH agent binary data inside JSON messages on the existing session WebSocket.

**Rationale**: The session WebSocket already carries JSON messages (output, state, progress, phase). Adding binary frames would require mixed-mode handling. SSH signing payloads are small (~100-500 bytes), so base64 overhead is negligible.

**Alternatives considered**:
- Separate binary WebSocket — adds connection management complexity for marginal benefit
- Raw binary frames on existing WebSocket — requires mixed text/binary frame handling

## Decision 3: Remote Host Context for Sign Request Display

**Decision**: The remote hostname is NOT available in the SSH agent signed data. The server derives display context from the project's git remote configuration (`git remote -v`), which it already knows at session creation time.

**Rationale**: Per RFC 4252, the signed data contains: session identifier (a hash, not the hostname), username ("git"), service name ("ssh-connection"), key algorithm, and key blob. The session identifier is an opaque exchange hash. To display "signing for git push to github.com:user/repo.git", the server must look up the project's configured SSH remote.

**Alternatives considered**:
- Parsing session identifier for hostname — not possible, it's a hash
- Intercepting the SSH connection at a lower level — too invasive

## Decision 4: Socket Path and Lifecycle

**Decision**: One Unix socket per session at `<dataDir>/sessions/<sessionId>/agent.sock`. Created before process spawn, cleaned up on session end.

**Rationale**: Co-locating with session data is natural. The socket path is short enough for the ~107-byte Unix socket path limit. Each session gets its own socket, avoiding multiplexing complexity.

**Alternatives considered**:
- Shared socket for all sessions — requires multiplexing and request routing
- Socket in `/tmp` — doesn't co-locate with session data

## Decision 5: Message Accumulation

**Decision**: Standard buffer accumulation pattern for stream-oriented Unix sockets. Buffer incoming bytes, read 4-byte length header, wait for full message, then process.

**Rationale**: Unix domain sockets are stream-oriented — a single `data` event may contain partial, complete, or multiple messages. The accumulation pattern is standard for any SSH agent proxy.

## Decision 6: Opt-in SSH Auth

**Decision**: Only create SSH agent bridge socket when the project has an SSH git remote configured. Detect via `git remote -v` before session launch.

**Rationale**: Most projects during the interview phase won't have remotes configured yet. Creating unused sockets adds overhead and noise. Checking for SSH remotes is a fast, single command.

**Alternatives considered**:
- Always create socket — unnecessary overhead for projects without SSH remotes
- Explicit opt-in flag — adds API complexity for something the server can auto-detect

## SSH Agent Protocol Reference

### Message Format

```
uint32    message_length    (big-endian, excludes the 4-byte length field itself)
byte      message_type
byte[]    message_contents  (message_length - 1 bytes)
```

### Whitelisted Request Types

| Type | Constant | Fields |
|------|----------|--------|
| 11 | SSH_AGENTC_REQUEST_IDENTITIES | (none) |
| 13 | SSH_AGENTC_SIGN_REQUEST | string key_blob, string data, uint32 flags |

### Response Types

| Type | Constant | Fields |
|------|----------|--------|
| 5 | SSH_AGENT_FAILURE | (none) |
| 12 | SSH_AGENT_IDENTITIES_ANSWER | uint32 nkeys, then nkeys × (string key_blob, string comment) |
| 14 | SSH_AGENT_SIGN_RESPONSE | string signature |

### Sign Request Data Structure (SSH userauth)

```
string    session_identifier    (exchange hash — opaque, not hostname)
byte      50                    (SSH_MSG_USERAUTH_REQUEST)
string    user_name             (e.g., "git")
string    service_name          ("ssh-connection")
string    "publickey"
boolean   TRUE
string    public_key_algorithm
string    public_key_blob
```

### Sign Request Flags

| Flag | Value | Meaning |
|------|-------|---------|
| SSH_AGENT_RSA_SHA2_256 | 2 | Request rsa-sha2-256 signature |
| SSH_AGENT_RSA_SHA2_512 | 4 | Request rsa-sha2-512 signature |
