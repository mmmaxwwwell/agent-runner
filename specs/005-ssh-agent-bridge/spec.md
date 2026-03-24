# Feature Specification: SSH Agent WebSocket Bridge

**Feature Branch**: `005-ssh-agent-bridge`
**Created**: 2026-03-23
**Status**: Draft
**Input**: Server-side SSH agent protocol proxy over WebSocket for remote Yubikey authentication. This feature delivers the server-side bridge only — the client-side signing implementation (Android app with Yubikey PIV) ships in 006-android-client. Testing uses a mock WebSocket client.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent Git Push Triggers Auth Request (Priority: P1)

A Claude agent working inside the sandbox needs to push code to GitHub. It runs `git push`, which triggers an SSH authentication challenge. The server intercepts this via a custom Unix socket (acting as `SSH_AUTH_SOCK`), parses the SSH agent protocol message to determine what's being signed, and forwards the sign request over WebSocket to the connected client. The client displays what's being signed and the user authorizes by touching their Yubikey. The signed response flows back through the WebSocket to the Unix socket, and the git push completes.

**Why this priority**: This is the core value — enabling git push from sandboxed agents using hardware key authentication where the key is physically connected to the client device, not the server.

**Independent Test**: Configure a project with a GitHub SSH remote. Trigger a `git push` from within the sandbox. Verify: the server creates the SSH agent socket, intercepts the sign request, forwards it over WebSocket, receives the signed response, and the push completes successfully.

**Acceptance Scenarios**:

1. **Given** a sandboxed agent runs `git push` with an SSH remote, **When** git requests SSH authentication, **Then** the server intercepts the request via the custom SSH_AUTH_SOCK, parses it, and sends a sign request over WebSocket to the connected client.
2. **Given** the client receives a sign request, **When** the request is displayed with operation details (e.g., "signing for git push to github.com:user/repo.git"), **Then** the user can authorize by touching their Yubikey or cancel the request.
3. **Given** the user touches their Yubikey to authorize, **When** the signed response is received by the server, **Then** the server forwards it to the SSH agent socket and the git push completes.
4. **Given** the user cancels the sign request, **When** the cancellation is received by the server, **Then** the SSH agent returns a failure response and git push fails gracefully.
5. **Given** no client is connected via WebSocket, **When** the agent attempts git push, **Then** the SSH agent socket returns a failure immediately (no hang).

---

### User Story 2 - List SSH Keys (Priority: P1)

When the SSH agent socket receives an `SSH_AGENTC_REQUEST_IDENTITIES` message (list keys), the server forwards it to the client. The client responds with the Yubikey's public key(s). This allows git and other SSH tools to discover available keys without requiring a Yubikey touch.

**Why this priority**: Key listing is required before signing can work — SSH clients always list keys first to find the right one to sign with.

**Independent Test**: Set `SSH_AUTH_SOCK` to the bridge socket. Run `ssh-add -L`. Verify the Yubikey's public key is returned.

**Acceptance Scenarios**:

1. **Given** a process queries `SSH_AUTH_SOCK` for available keys, **When** the server receives `SSH_AGENTC_REQUEST_IDENTITIES`, **Then** it forwards to the client and returns the Yubikey's public key(s).
2. **Given** the Yubikey is not connected to the client, **When** key listing is requested, **Then** an empty key list or error is returned.

---

### User Story 3 - Protocol Message Whitelisting (Priority: P2)

The SSH agent bridge only forwards whitelisted message types: `SSH_AGENTC_REQUEST_IDENTITIES` (list keys) and `SSH_AGENTC_SIGN_REQUEST` (sign data). All other SSH agent protocol messages are dropped with an appropriate failure response. This minimizes attack surface.

**Why this priority**: Security hardening. The bridge should only support the minimum operations needed for git push authentication.

**Independent Test**: Send an `SSH_AGENTC_REMOVE_ALL_IDENTITIES` message to the bridge socket. Verify it returns `SSH_AGENT_FAILURE` without forwarding to the client.

**Acceptance Scenarios**:

1. **Given** the bridge receives `SSH_AGENTC_REQUEST_IDENTITIES` (type 11), **When** processing the message, **Then** it is forwarded to the client.
2. **Given** the bridge receives `SSH_AGENTC_SIGN_REQUEST` (type 13), **When** processing the message, **Then** it is forwarded to the client with operation details extracted for display.
3. **Given** the bridge receives any other message type (e.g., type 18 — remove identity), **When** processing the message, **Then** `SSH_AGENT_FAILURE` (type 5) is returned and the message is NOT forwarded.

---

### User Story 4 - Sign Request Display Context (Priority: P2)

When a sign request is forwarded to the client, the server extracts enough context from the SSH agent protocol message to display a meaningful description. For git operations, this includes the remote host and repository being pushed to.

**Why this priority**: Users need to know what they're authorizing. "Sign request from process X" is not useful — "signing for git push to github.com:user/repo.git" is.

**Independent Test**: Trigger a git push to a known GitHub repo. Verify the client-side display shows the correct remote host and repo path.

**Acceptance Scenarios**:

1. **Given** a sign request for a git push operation, **When** the server builds the display context, **Then** it combines the project's SSH remote URL (from `git remote -v`, detected at session launch) with the username and key algorithm extracted from the sign request, and includes this in the WebSocket message to the client.
2. **Given** a sign request where the session data is not parseable as SSH session info, **When** the server forwards it, **Then** it includes a generic description ("SSH sign request from sandboxed agent") rather than failing.

---

### User Story 5 - Multiple Concurrent Sessions (Priority: P3)

Multiple sandboxed agent processes may need SSH auth simultaneously (e.g., two projects pushing at the same time). Each agent gets its own SSH agent socket. The bridge multiplexes all sockets over the WebSocket connection to the client, using request IDs to correlate responses.

**Why this priority**: Lower priority — the current system enforces one active session per project, so concurrent pushes are rare. But the architecture should support it for robustness.

**Independent Test**: Start two agent sessions. Both attempt git push simultaneously. Verify both sign requests are forwarded to the client and both pushes complete after authorization.

**Acceptance Scenarios**:

1. **Given** two agent processes request signing simultaneously, **When** both requests are forwarded over the WebSocket, **Then** each request has a unique ID and responses are routed to the correct socket.
2. **Given** the user authorizes one request and cancels another, **When** responses are received, **Then** the correct socket gets the correct response (push succeeds on one, fails on the other).

---

### Edge Cases

- What happens when the WebSocket connection drops mid-signing? The SSH agent socket should return failure after a timeout (e.g., 30 seconds) rather than hanging indefinitely.
- What happens when the Yubikey is disconnected from the client during signing? The client should detect the error and send a failure response.
- What happens when the agent process exits while a sign request is pending? The Unix socket is cleaned up and the pending WebSocket request is cancelled.
- What happens when the client reconnects after a disconnect? Pending sign requests from before the disconnect should be failed (not replayed).
- What happens when the SSH agent socket file already exists (stale from a crashed session)? The server should remove it and create a new one.
- What happens when the bridge receives malformed SSH agent protocol data? It should return `SSH_AGENT_FAILURE` and log the error, not crash.

## Requirements *(mandatory)*

### Functional Requirements

#### SSH Agent Socket Management

- **FR-001**: The server MUST create a Unix socket file per agent session at a predictable path (e.g., `<dataDir>/sessions/<sessionId>/agent.sock`).
- **FR-002**: The sandbox MUST set `SSH_AUTH_SOCK` to point to the bridge socket so that git and ssh commands use it automatically.
- **FR-003**: The Unix socket MUST be bound into the sandbox via `BindPaths` so the sandboxed agent can access it.
- **FR-004**: When a session ends (completed, failed, or stopped), the server MUST clean up the Unix socket file.
- **FR-005**: If a stale socket file exists at the path, the server MUST remove it before creating a new one.

#### SSH Agent Protocol Parsing

- **FR-006**: The server MUST parse incoming SSH agent protocol messages to extract the message type byte.
- **FR-007**: Only `SSH_AGENTC_REQUEST_IDENTITIES` (type 11) and `SSH_AGENTC_SIGN_REQUEST` (type 13) MUST be forwarded to the client. All other message types MUST return `SSH_AGENT_FAILURE` (type 5).
- **FR-008**: For `SSH_AGENTC_SIGN_REQUEST` messages, the server MUST extract the key blob and data fields to provide context about what is being signed.
- **FR-009**: The server MUST derive the remote host context from the project's git remote configuration (`git remote -v`), NOT from the signed data (which contains an opaque session hash, not the hostname). The display format is "signing for git push to github.com:user/repo.git".
- **FR-010**: If the project has no SSH remote configured or the remote URL cannot be parsed, the server MUST fall back to a generic description ("SSH sign request from sandboxed agent").

#### WebSocket Relay

- **FR-011**: SSH agent requests MUST be relayed to the connected client via the existing WebSocket connection (same connection used for session streaming).
- **FR-012**: Each relayed request MUST include a unique request ID for response correlation.
- **FR-013**: The client MUST respond with the corresponding request ID and either a signed response or a cancellation.
- **FR-014**: If no client is connected when a sign request arrives, the server MUST immediately return `SSH_AGENT_FAILURE` to the Unix socket.
- **FR-015**: If the client does not respond within 60 seconds, the server MUST return `SSH_AGENT_FAILURE` (timeout).
- **FR-016**: The WebSocket message type for SSH agent requests MUST be `{ type: 'ssh-agent-request', requestId, messageType, context, data }` where `data` is base64-encoded binary SSH agent protocol bytes.
- **FR-017**: The WebSocket message type for SSH agent responses MUST be `{ type: 'ssh-agent-response', requestId, data }` or `{ type: 'ssh-agent-cancel', requestId }`.

#### Sandbox Integration

- **FR-018**: The `buildCommand()` function MUST be updated to create the SSH agent socket and set `SSH_AUTH_SOCK` in the sandbox environment only when the project has an SSH git remote configured (detected via `git remote -v`).
- **FR-019**: The SSH agent bridge MUST work with the existing systemd-run sandbox — the socket path must be accessible inside the sandbox via `BindPaths`.
- **FR-020**: The server MUST detect SSH remotes by checking `git remote -v` in the project directory before session launch. If no SSH remote is found, no bridge socket is created.

### Key Entities

- **SSHAgentBridge**: Server-side service that manages Unix socket creation, SSH agent protocol parsing, and WebSocket relay. One instance per active session that needs SSH auth.
- **SSHAgentRequest**: A parsed SSH agent protocol message with `requestId`, `messageType`, `context` (human-readable description), and raw `data` (base64-encoded protocol bytes for the client).
- **SSHAgentResponse**: Client response with `requestId` and either signed `data` or cancellation flag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A sandboxed agent can successfully `git push` to a GitHub SSH remote using Yubikey authentication relayed through the WebSocket bridge.
- **SC-002**: The client displays a human-readable description of what is being signed (e.g., remote host and repo) before the user authorizes.
- **SC-003**: Non-whitelisted SSH agent message types are rejected without forwarding.
- **SC-004**: If no client is connected or the client cancels, the git push fails gracefully (no hang, no crash).
- **SC-005**: The SSH agent socket is cleaned up when the session ends.
- **SC-006**: The bridge handles malformed protocol data without crashing.

## Clarifications

### Session 2026-03-23

- Q: Which client handles the Yubikey signing in 005? → A: Server-side bridge only in 005; client-side signing deferred to 006 (Android app). Test with mock client.
- Q: Should SSH auth be enabled for every session or opt-in? → A: Only create SSH agent socket when the project has an SSH git remote configured.
- Q: Hand-written SSH agent protocol parser or npm dependency? → A: Hand-written. Protocol is tiny (2 message types, binary framing: 4-byte length + 1-byte type + payload).
- Q: How to encode binary SSH agent data on the JSON WebSocket? → A: Base64-encode inside JSON messages. Uniform protocol, negligible overhead for signing payloads.
