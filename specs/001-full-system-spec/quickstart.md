# Quickstart: Agent Runner

## Prerequisites

- NixOS or Linux with Nix installed (flakes enabled)
- `systemd-run --user` available (default on NixOS/systemd distros)
- `claude` CLI installed and authenticated

## Setup

```bash
cd agent-runner
nix develop    # Enters dev shell with Node.js 22, uv, Java 17

npm install    # Install dependencies
npm run build  # Compile TypeScript + bundle PWA client
```

## Run

```bash
# Development (auto-reload)
nix develop -c npm run dev

# Production
nix develop -c npm start
```

Server starts on `http://localhost:3000` by default.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_RUNNER_HOST` | `localhost` | Bind address (use `0.0.0.0` for LAN) |
| `AGENT_RUNNER_PORT` | `3000` | Listen port |
| `AGENT_RUNNER_DATA_DIR` | `~/.local/share/agent-runner` | Data directory |
| `AGENT_RUNNER_PROJECTS_DIR` | `~/git` | Projects directory to scan |
| `AGENT_RUNNER_LOG_LEVEL` | `info` | Log level |
| `ALLOW_UNSANDBOXED` | `false` | Allow unsandboxed agent execution |
| `GOOGLE_STT_API_KEY` | — | Google Speech-to-Text API key |
| `DISK_WARN_THRESHOLD_MB` | `8192` | Disk space warning threshold |

## Test

```bash
nix develop -c npm test
```

Runs all unit, integration, and contract tests.

## Key Workflows

1. **Register project**: Dashboard → project appears from directory scan → click Onboard
2. **New project**: Dashboard → "New Project" → enter name → interview starts
3. **Run tasks**: Project detail → "Run Tasks" → autonomous task execution
4. **Add feature**: Project detail → "Add Feature" → spec-kit SDD workflow
5. **Monitor**: Dashboard shows all projects with live status; tap into sessions for streaming output
6. **SSH signing**: Android app → sign request modal → Yubikey touch → git push completes

## Project Structure

```
src/
├── server.ts              # HTTP/WebSocket server entry point
├── models/                # Project, Session data models (JSON file storage)
├── routes/                # REST API handlers
├── services/              # Business logic (process mgr, sandbox, SSH bridge, etc.)
├── ws/                    # WebSocket handlers (session stream, dashboard)
├── lib/                   # Config, logger utilities
└── client/                # Preact PWA source
    ├── app.tsx            # Router + app shell
    ├── components/        # UI components
    ├── lib/               # API client, WebSocket client, router
    └── sw.ts              # Service worker

tests/
├── unit/                  # Unit tests for services, models, utilities
├── integration/           # Integration tests for workflows and lifecycle
└── contract/              # API contract tests (REST + WebSocket)

android/                   # Android app (Kotlin, WebView + Yubikey PIV)
```
