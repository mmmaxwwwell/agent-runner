# Quickstart: Agent Runner Server and PWA

## Prerequisites

- NixOS with `nix` and `nix develop` available
- `systemd-run --user` available (standard on NixOS)
- `claude` CLI installed and configured
- Agent-framework project(s) with `*-tasks.md` and `*-prompt.md` files

## Setup

```bash
# Enter the dev shell
nix develop

# Install dependencies
npm install

# Generate VAPID keys for push notifications (first time only)
npx web-push generate-vapid-keys
# Save the output to environment variables (see below)

# Build TypeScript
npm run build
```

## Environment Variables

```bash
export AGENT_RUNNER_HOST=127.0.0.1    # Bind address (0.0.0.0 for LAN)
export AGENT_RUNNER_PORT=3000          # Server port
export AGENT_RUNNER_DATA_DIR=~/.agent-runner  # Runtime data
export LOG_LEVEL=info                  # debug|info|warn|error|fatal
export VAPID_PUBLIC_KEY=BEl62i...      # From web-push generate
export VAPID_PRIVATE_KEY=abc123...     # From web-push generate
export VAPID_SUBJECT=mailto:you@example.com
```

## Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Open `http://localhost:3000` in a browser (or `http://<host-ip>:3000` from mobile on the same network).

## Usage

1. **Register a project**: Click "Add Project", enter the directory path and display name
2. **Start a task run**: Tap the play button on a project card
3. **Monitor output**: Tap a running project to see live agent output
4. **Answer questions**: When notified of a blocked task, tap the notification to respond
5. **Create via voice**: Tap "New Project" → speak to start an interview

## Development

```bash
# Run tests
npm test

# Run with debug logging
LOG_LEVEL=debug npm run dev

# Type check
npm run build
```

## Project Structure

```
src/
├── server.ts              # HTTP + WebSocket server entry point
├── models/
│   ├── project.ts         # Project registry (projects.json CRUD)
│   └── session.ts         # Session lifecycle management
├── services/
│   ├── process-manager.ts # Spawn/manage sandboxed agent processes
│   ├── sandbox.ts         # systemd-run command builder
│   ├── task-parser.ts     # Parse *-tasks.md files
│   ├── session-logger.ts  # JSONL log writer/reader
│   ├── push.ts            # Web Push notification sender
│   └── recovery.ts        # Crash recovery on startup
├── routes/
│   ├── projects.ts        # /api/projects endpoints
│   ├── sessions.ts        # /api/sessions endpoints
│   └── push.ts            # /api/push endpoints
├── ws/
│   ├── session-stream.ts  # /ws/sessions/:id handler
│   └── dashboard.ts       # /ws/dashboard handler
└── lib/
    ├── logger.ts          # Pino structured logger
    └── config.ts          # Environment config

public/
├── index.html             # PWA shell
├── manifest.json          # Web app manifest
├── sw.js                  # Service worker (push + offline)
├── app.js                 # Main application module
├── components/
│   ├── dashboard.js       # Project list view
│   ├── project-detail.js  # Project detail + task list
│   ├── session-view.js    # Live output terminal view
│   ├── new-project.js     # New project / interview view
│   └── settings.js        # Settings (voice backend toggle)
└── lib/
    ├── api.js             # REST API client
    ├── ws.js              # WebSocket client with reconnect
    ├── voice.js           # Voice input (Web Speech + cloud API)
    └── router.js          # Client-side hash router

tests/
├── unit/
│   ├── task-parser.test.ts
│   ├── sandbox.test.ts
│   └── session-logger.test.ts
├── integration/
│   ├── process-manager.test.ts
│   ├── websocket.test.ts
│   ├── task-loop.test.ts
│   └── recovery.test.ts
└── contract/
    ├── rest-api.test.ts
    └── websocket-api.test.ts
```
