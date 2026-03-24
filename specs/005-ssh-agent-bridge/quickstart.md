# Quickstart: SSH Agent WebSocket Bridge

## Verify Development Environment

```bash
nix develop -c bash
node --version  # v22.x
npm test
npm run build
```

## Key Files to Understand

1. `src/services/sandbox.ts` — Sandbox command builder (adding env var support)
2. `src/ws/session-stream.ts` — WebSocket session streaming (adding ssh-agent message handling)
3. `src/services/process-manager.ts` — Process spawning (understanding how env is passed)
4. `src/routes/sessions.ts` — Session creation (where bridge gets wired up)

## SSH Agent Protocol Quick Reference

```
Message format: [4-byte big-endian length][1-byte type][payload]

REQUEST_IDENTITIES (type 11): no payload
SIGN_REQUEST (type 13): string key_blob, string data, uint32 flags
IDENTITIES_ANSWER (type 12): uint32 nkeys, then nkeys × (string key_blob, string comment)
SIGN_RESPONSE (type 14): string signature
FAILURE (type 5): no payload

SSH string: [4-byte big-endian length][length bytes of data]
```

## Manual Testing

### Test Unix socket creation
```bash
# Create a test socket and verify it works
node -e "
const net = require('net');
const fs = require('fs');
const sock = '/tmp/test-agent.sock';
if (fs.existsSync(sock)) fs.unlinkSync(sock);
const srv = net.createServer(c => {
  c.on('data', d => console.log('received', d.length, 'bytes, type:', d[4]));
  // Return SSH_AGENT_FAILURE
  c.write(Buffer.from([0,0,0,1,5]));
});
srv.listen(sock, () => {
  console.log('Listening on', sock);
  fs.chmodSync(sock, 0o600);
});
"
```

### Test SSH agent protocol with the socket
```bash
# In another terminal, set SSH_AUTH_SOCK and list keys
SSH_AUTH_SOCK=/tmp/test-agent.sock ssh-add -L
# Should show "The agent has no identities" (because we return FAILURE)
```

### Test with real yubikey-agent
```bash
# Verify yubikey-agent is running
echo $SSH_AUTH_SOCK
# Should be: /run/user/1000/yubikey-agent/yubikey-agent.sock

# List keys from yubikey
ssh-add -L
# Should show: ecdsa-sha2-nistp256 ... YubiKey #20569688 PIV Slot 9a
```

## Testing the Bridge (Integration)

Once implemented, test the full bridge flow:

```bash
# 1. Start the server
nix develop -c npm run dev

# 2. Create a project with an SSH remote
mkdir /tmp/test-ssh-project && cd /tmp/test-ssh-project
git init && git remote add origin git@github.com:user/repo.git

# 3. Onboard the project via the API
curl -X POST http://localhost:3000/api/projects/onboard \
  -H 'Content-Type: application/json' \
  -d '{"path":"/tmp/test-ssh-project"}'

# 4. Start a session — should create agent.sock
# 5. Connect WebSocket client to /ws/sessions/:id
# 6. Trigger git push from agent — should see ssh-agent-request on WebSocket
```
