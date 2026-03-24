# Data Model: SSH Agent WebSocket Bridge

## New Entities

### SSHAgentBridge

Server-side service managing the Unix socket proxy for one session.

```typescript
interface SSHAgentBridge {
  sessionId: string;
  socketPath: string;              // <dataDir>/sessions/<sessionId>/agent.sock
  projectDir: string;              // For deriving remote context
  remoteContext: string;           // e.g., "github.com:user/repo.git" from git remote -v
  server: net.Server;              // Unix domain socket server
  pendingRequests: Map<string, PendingRequest>;  // requestId → pending state
}

interface PendingRequest {
  requestId: string;
  messageType: number;             // 11 or 13
  clientSocket: net.Socket;        // The Unix socket connection to respond to
  timeoutTimer: NodeJS.Timeout;    // 60-second timeout
  createdAt: number;               // timestamp
}
```

**Lifecycle:**
1. Created when session launches (if project has SSH remote)
2. Unix socket created at `socketPath`
3. Accepts connections from sandboxed agent's git/ssh processes
4. Parses SSH agent messages, forwards whitelisted types over WebSocket
5. Receives responses from WebSocket, writes back to Unix socket
6. Destroyed when session ends — socket file removed

### SSHAgentMessage (parsed)

```typescript
interface SSHAgentMessage {
  type: number;                    // Message type byte
  raw: Buffer;                     // Full message bytes (excluding 4-byte length prefix)
}
```

### SSHAgentSignRequest (parsed from type 13)

```typescript
interface SSHAgentSignRequest {
  keyBlob: Buffer;                 // Public key in SSH wire format
  data: Buffer;                    // Data to be signed
  flags: number;                   // Signature flags (uint32)
  // Extracted from data (if parseable as SSH userauth):
  username?: string;               // e.g., "git"
  keyAlgorithm?: string;           // e.g., "ecdsa-sha2-nistp256"
}
```

### WebSocket Messages (new types)

**Server → Client (sign request):**
```typescript
{
  type: 'ssh-agent-request';
  requestId: string;               // UUID for correlation
  messageType: 11 | 13;            // SSH agent message type
  context: string;                 // Human-readable: "Sign for git push to github.com:user/repo.git"
  data: string;                    // Base64-encoded full SSH agent message bytes
}
```

**Client → Server (sign response):**
```typescript
{
  type: 'ssh-agent-response';
  requestId: string;               // Matches the request
  data: string;                    // Base64-encoded SSH agent response bytes
}
```

**Client → Server (cancel):**
```typescript
{
  type: 'ssh-agent-cancel';
  requestId: string;               // Matches the request
}
```

## Modified Entities

### SandboxCommand (from sandbox.ts)

When SSH auth is enabled, `buildCommand()` adds:
- `SSH_AUTH_SOCK=<socketPath>` to the process environment
- `BindPaths` includes the socket path's parent directory

```typescript
interface SandboxCommand {
  command: string;
  args: string[];
  unsandboxed: boolean;
  env?: Record<string, string>;    // NEW — additional env vars (SSH_AUTH_SOCK)
}
```

### Session WebSocket (session-stream.ts)

Adds handler for incoming `ssh-agent-response` and `ssh-agent-cancel` messages from the client. Routes them to the correct `SSHAgentBridge` instance via the session's registered bridge.

## File Layout

### New Files

```text
src/
├── services/
│   ├── ssh-agent-bridge.ts        # NEW — Unix socket server, protocol parser, WebSocket relay
│   └── ssh-agent-protocol.ts      # NEW — Binary protocol parsing utilities
└── ...

tests/
├── unit/
│   ├── ssh-agent-protocol.test.ts # NEW — Protocol parsing tests
│   └── ssh-agent-bridge.test.ts   # NEW — Bridge lifecycle tests
└── integration/
    └── ssh-agent-bridge.test.ts   # NEW — End-to-end with mock WebSocket client
```

### Modified Files

```text
src/
├── services/
│   └── sandbox.ts                 # MODIFY — add env support, SSH_AUTH_SOCK
├── routes/
│   ├── projects.ts                # MODIFY — create bridge when SSH remote detected
│   └── sessions.ts                # MODIFY — create bridge when SSH remote detected
├── ws/
│   └── session-stream.ts          # MODIFY — handle ssh-agent-response/cancel messages
└── ...
```

## SSH Remote Detection

```typescript
function detectSSHRemote(projectDir: string): string | null {
  // Run: git -C <projectDir> remote -v
  // Parse output for SSH URLs: git@host:user/repo.git or ssh://...
  // Return first SSH remote URL, or null if none
}
```

Called before session launch. Result stored in the bridge's `remoteContext` for display.
