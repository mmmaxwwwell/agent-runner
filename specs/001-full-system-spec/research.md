# Research: Agent Runner Full System

**Branch**: `001-full-system-spec` | **Date**: 2026-03-24

## 1. Node.js Server Architecture (HTTP + WebSocket, No Framework)

**Decision**: Raw `http.createServer` with route Map for REST; `ws` in `noServer` mode with manual upgrade handling.

**Rationale**: The API surface is small (~16 endpoints). A framework adds unnecessary abstraction and dependency weight. `noServer` mode gives full control over the WebSocket upgrade handshake, enabling path-based multiplexing (`/ws/sessions/:id`, `/ws/dashboard`).

**Alternatives considered**:
- *Fastify* — Good performance, but unnecessary abstraction for a small API surface.
- *Express* — Heavy middleware chain, complicates WebSocket integration, ~30ms startup overhead.
- *Hono* — Primarily designed for edge runtimes; less mature WebSocket story on Node.js.

**Best practices**:
- Route registration via `Map<string, handler>` — O(1) exact match, linear scan only for parameterized routes.
- Reject unknown upgrade paths by writing `HTTP/1.1 404` and calling `socket.destroy()`.
- Body size limit (1MB) on POST/PUT to prevent memory exhaustion.
- Wrap every route handler in try/catch; check `res.headersSent` before writing error responses.

## 2. Child Process Lifecycle Management

**Decision**: `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']`, readline for line-by-line capture, process registry Map for cross-module handle access.

**Rationale**: `spawn` is the only option for long-running processes with streaming output. `exec`/`execFile` buffer entire output in memory.

**Alternatives considered**:
- *`exec`/`execFile`* — Buffer entire output. Unsuitable for streaming.
- *`execa`* — Nice API sugar but unnecessary dependency.
- *`fork`* — Only for Node.js child scripts with IPC.

**Best practices**:
- Listen for `close` (not `exit`) — ensures stdio streams are fully flushed.
- `createInterface({ input: child.stdout })` for correct line buffering and UTF-8 handling.
- SIGTERM first, then SIGKILL after 5-second timeout for hung processes.
- Guard `child.pid === undefined` for spawn failures.
- Listen for `error` event on child to catch spawn failures.
- When using `systemd-run`, the child PID is the wrapper — track the unit name for reliable cleanup.

## 3. SSH Agent Binary Protocol Parsing

**Decision**: Manual `Buffer` parsing with `readUInt32BE`/`subarray` plus `MessageAccumulator` for stream reassembly.

**Rationale**: The SSH agent protocol is tiny (2 forwarded message types, length-prefixed framing). A parsing library would be overkill.

**Alternatives considered**:
- *`binary-parser`* — Adds dependency for minimal benefit with only 3 message types.
- *Protocol Buffers* — Not applicable; SSH agent is a fixed IETF binary format.

**Best practices**:
- Accumulator pattern for TCP stream reassembly (data arrives in arbitrary chunks).
- `Buffer.from(buf.subarray(...))` to copy when original buffer will be reused.
- Maximum message size check (256KB) to prevent memory exhaustion from malformed length prefixes.
- Whitelist only types 11 (REQUEST_IDENTITIES) and 13 (SIGN_REQUEST); return FAILURE for all others.
- Network byte order (big-endian) for all integer fields.

## 4. Web Push Notifications (Self-Hosted)

**Decision**: `web-push` library with VAPID keys, file-backed subscription storage, automatic cleanup of expired subscriptions.

**Rationale**: VAPID-based Web Push (RFC 8030/8292) works directly with browser push services without third-party accounts. Ideal for self-hosted single-user deployment.

**Alternatives considered**:
- *Firebase Cloud Messaging* — Requires Google account, adds vendor lock-in.
- *Server-Sent Events* — Only works with browser tab open.

**Best practices**:
- Generate VAPID keys once, persist securely (not in source control).
- Remove subscriptions on HTTP 410/404 responses.
- Payload limit ~4KB — keep notifications small (title, body, routing data).
- Service worker `push` handler must call `event.waitUntil(showNotification(...))`.

## 5. Pino Structured Logging

**Decision**: Single root pino logger writing JSON to stderr, child loggers per component with `component` field.

**Rationale**: Pino is 5-10x faster than Winston/Bunyan. JSON to stderr follows Unix convention (stdout for app output, stderr for logs).

**Alternatives considered**:
- *Winston* — More features but 5-10x slower.
- *Bunyan* — Similar philosophy but less actively maintained.

**Best practices**:
- Child loggers: `rootLogger.child({ component: 'name' })` for zero-overhead context.
- Structured context as first argument: `log.info({ sessionId, pid }, 'Process spawned')`.
- Built-in `err` serializer extracts `message`, `type`, `stack`.
- Runtime level changes via `rootLogger.level` propagate to all children.
- `pino-pretty` for dev only (10x slower).

## 6. Preact PWA with Service Worker

**Decision**: Preact (3KB gzipped) with hand-written service worker: cache-first for app shell, network-first for API.

**Rationale**: Preact provides React-compatible API at 1/10th the size. Perfect for a monitoring dashboard PWA.

**Alternatives considered**:
- *React* — 40KB+ gzipped, no advantage for this use case.
- *Workbox* — Unnecessary abstraction when caching logic is simple (3 strategies).
- *Vanilla JS* — Unmaintainable as UI complexity grows.

**Best practices**:
- Cache `index.html`, `app.js`, static assets on `install` for instant repeat-visit loading.
- Cache versioning with `CACHE_NAME` increment; `activate` handler deletes old caches.
- `skipWaiting()` + `clients.claim()` for immediate activation (correct for single-user).
- Hash-based routing (`/#/sessions/{id}`) works with service workers without special config.

## 7. esbuild for Preact JSX Bundling

**Decision**: esbuild with `--jsx=automatic --jsx-import-source=preact`, single-file bundle output.

**Rationale**: 10-100x faster than Webpack/Rollup. Configuration is minimal for a small PWA.

**Alternatives considered**:
- *Vite* — Uses Rollup for production; slower but slightly smaller bundles. Overkill here.
- *Webpack* — 10-100x slower, complex configuration.

**Best practices**:
- `--jsx=automatic` eliminates manual `import { h } from 'preact'`.
- Add `--minify` and `--target=es2022` for production builds.
- Service worker bundled separately as a single file at fixed URL.
- `--watch` for sub-100ms dev rebuilds.

## 8. Process Sandboxing with systemd-run --user

**Decision**: `systemd-run --user` with `ProtectHome=tmpfs`, `BindPaths`, `BindReadOnlyPaths`, `NoNewPrivileges`, `PrivateDevices`, `PrivateTmp`.

**Rationale**: Robust process isolation without root privileges or container runtimes. Available by default on NixOS.

**Alternatives considered**:
- *Docker/Podman* — Heavier, requires container images, seconds of startup latency vs. milliseconds.
- *bubblewrap* — Similar but requires manual namespace setup, less systemd integration.
- *No sandboxing* — Unacceptable for autonomous AI agents with filesystem access.

**Best practices**:
- `ProtectHome=tmpfs` hides real home; only bind-mounted paths visible.
- Two-gate override: server env var AND per-request flag required for unsandboxed.
- SSH agent socket path added to `BindPaths` for bridge access.
- `--pipe` connects stdio through the wrapper.
- Consider `MemoryMax=4G` and `CPUQuota=200%` for resource limits.
- Track unit name for cleanup on server restart.

## 9. Android Yubikey PIV Signing (yubikit-android)

**Decision**: `yubikit-android` 3.0.1 for USB/NFC transport with PIV applet, bridged to WebView via `@JavascriptInterface`.

**Rationale**: Official Yubico SDK provides low-level PIV access for SSH signature operations. Only viable option for hardware key signing on Android without root.

**Alternatives considered**:
- *OpenSC/PKCS#11* — Requires native libraries, doesn't work on Android without root.
- *Android Keystore* — Only for device-generated keys, cannot access Yubikey-stored keys.

**Best practices**:
- Support USB-C (`UsbYubiKeyDevice`) and NFC (`NfcYubiKeyDevice`); prefer USB for reliability.
- SSH keys typically in PIV slot `9a` (Authentication).
- PIN cached in memory only (cleared on app destruction), never persisted.
- PIV produces raw signatures; must wrap in SSH signature format (algorithm string + signature blob).
- Initially support ECDSA P-256 only; return clear error for other key types.
- ProGuard/R8 keep rules for `com.yubico.yubikit.**` and `@JavascriptInterface` methods.
- Async bridge: JavaScript calls Kotlin, result delivered via `webView.evaluateJavascript()`.

## 10. Existing Codebase State

The codebase already implements the majority of the system described in the spec:

**Fully implemented**:
- Server with HTTP + WebSocket (raw `http` + `ws`)
- Project model (CRUD, status transitions, discovery)
- Session model (lifecycle, state machine, concurrent prevention)
- Task parser (markdown → Task[], summary aggregation)
- Process manager (spawn, task loop, kill)
- Sandbox service (systemd-run command building, two-gate override)
- Session logger (JSONL output logging)
- SSH agent bridge (Unix socket, protocol parsing, WebSocket relay)
- SSH agent protocol parser (accumulator, message types 11/13)
- Push notification service (VAPID, subscriptions, notifications)
- Discovery service (git, nix, spec-kit detection)
- Onboarding service (idempotent pipeline, flake generation)
- Recovery service (session resume on startup)
- Spec-kit service (interview, plan/tasks/analyze workflow)
- Transcript parser (Claude stream-json → markdown)
- Agent framework service (clone/update)
- Flake generator (stack detection, template generation)
- Disk monitor (threshold-based warnings)
- Config (env vars, defaults, VAPID key persistence)
- Logger (pino, child loggers, runtime level control)
- Full Preact PWA (dashboard, project detail, session view, new project, add feature, settings, spec-kit chat)
- Service worker (caching, push notifications)
- Voice transcription (Google STT, browser Web Speech API)
- Android app (WebView, Yubikey PIV, SSH agent bridge client)

**All routes implemented**: health, projects (CRUD + discovery + onboard + add-feature), sessions (CRUD + stop + input + ssh-response), push, voice.

**All WebSocket handlers implemented**: session-stream (output, state, progress, phase, SSH requests, replay), dashboard (project updates, onboarding steps).

**Test coverage**: 15 unit test files, 17 integration test files, 5 contract test files covering all services, models, routes, and WebSocket handlers.

**Implication for planning**: This is a consolidation spec, not a greenfield build. The plan should focus on ensuring completeness, consistency, and test coverage rather than building from scratch. Tasks will primarily be verification, gap-filling, and any missing features from the consolidated spec.
