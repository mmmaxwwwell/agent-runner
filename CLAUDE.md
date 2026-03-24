# agent-runner Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-24

## Active Technologies
- TypeScript 5.9 on Node.js 22 (via Nix flake) + `ws` (WebSocket), `web-push` (push notifications), `pino` (logging), `preact` (PWA client), `esbuild` (client bundler) (002-bugfixes-ui-flow-tests)
- Filesystem — `~/.agent-runner/projects.json`, session metadata in `sessions/{id}/meta.json`, output in `sessions/{id}/output.jsonl` (002-bugfixes-ui-flow-tests)
- Filesystem — `~/.local/share/agent-runner/projects.json`, session metadata in `sessions/{id}/meta.json`, output in `sessions/{id}/output.jsonl` (004-onboarding-overhaul)
- TypeScript 5.9 on Node.js 22 (via Nix flake) + `ws` (WebSocket), `net` (Node.js built-in for Unix sockets), `crypto` (UUID generation) (005-ssh-agent-bridge)
- Unix socket files at `<dataDir>/sessions/<sessionId>/agent.sock` (005-ssh-agent-bridge)
- Kotlin, Android API 26+ (Android 8.0 Oreo) + `yubikit-android` 3.0.1 (USB/NFC transport + PIV), Android WebView, `java-websocket` or OkHttp (native WebSocket) (006-android-client)
- Android SharedPreferences (server URL) (006-android-client)

- TypeScript on Node.js 22 (via Nix flake, compiled with `tsc`, dev with `tsx`) + `ws` (WebSocket), `web-push` (push notifications), `pino` (structured logging), `tsx` (dev) (001-agent-runner-server-pwa)

## Project Structure

```text
src/
tests/
```

## Commands

All commands MUST be prefixed with `nix develop -c` to run inside the Nix flake environment. Examples:

```bash
nix develop -c npm test && nix develop -c npm run lint
nix develop -c npm run build
nix develop -c npm run dev
nix develop -c uv tool install specify-cli --from "git+https://github.com/github/spec-kit.git"
nix develop -c specify --version
```

Never run `npm`, `node`, `tsx`, `uv`, or `specify` directly — always go through `nix develop -c`.

## Code Style

TypeScript on Node.js 22 (via Nix flake, compiled with `tsc`, dev with `tsx`): Follow standard conventions

## Recent Changes
- 001-full-system-spec: Consolidated specs 001–006 into unified system specification with comprehensive test coverage requirements
- 006-android-client: Added Kotlin, Android API 26+ (Android 8.0 Oreo) + `yubikit-android` 3.0.1 (USB/NFC transport + PIV), Android WebView, `java-websocket` or OkHttp (native WebSocket)
- 005-ssh-agent-bridge: Added TypeScript 5.9 on Node.js 22 (via Nix flake) + `ws` (WebSocket), `net` (Node.js built-in for Unix sockets), `crypto` (UUID generation)


<!-- MANUAL ADDITIONS START -->

## Workflow: Spec-Kit (Specification-Driven Development)

All feature work, bug fixes, and enhancements MUST go through the spec-kit SDD workflow. Do not implement changes ad-hoc. The workflow is:

1. **Specify** — Write a feature spec in `specs/<number>-<name>/spec.md`
2. **Clarify** — Resolve ambiguities in the spec
3. **Plan** — Generate `plan.md`, `data-model.md`, `research.md`
4. **Tasks** — Generate `tasks.md` with dependency-ordered, phased tasks
5. **Implement** — Execute tasks via `run-tasks.sh` or manually

Spec-kit project is already initialized (`.specify/` directory exists). Use the spec-kit skill or slash commands (`/speckit.specify`, `/speckit.clarify`, etc.) to drive each phase.

## Nix Flake Environment

This project uses Nix flakes for reproducible development. The `flake.nix` provides Node.js 22, uv, and all required tooling. All shell commands — including `npm`, `node`, `tsx`, `uv`, `specify`, and any CLI tools — MUST be run through `nix develop -c <command>`. Never install global packages or use system-level package managers.

<!-- MANUAL ADDITIONS END -->
