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

## 10. Android Keystore Signing Backend

**Decision**: Android Keystore API with `KeyGenParameterSpec` for ECDSA P-256, biometric-gated via `BiometricPrompt`.

**Rationale**: Provides software-based SSH signing for users without Yubikeys. Android Keystore is hardware-backed on most modern devices (TEE/StrongBox) and integrates natively with biometric authentication.

**Best practices**:
- `KeyGenParameterSpec.Builder` with `setKeyPurposes(PURPOSE_SIGN)`, `setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))`.
- `setUserAuthenticationRequired(true)` with `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` for per-use biometric.
- Use `BiometricPrompt` (AndroidX) for authentication — it handles fingerprint, face, and fallback automatically.
- Key aliases prefixed with `agent-runner-` to avoid collision.
- SSH signature wrapping: same format as Yubikey backend (algorithm string + DER-encoded signature → SSH blob).

## 11. Android Integration Test Infrastructure

**Decision**: AndroidX Test + Espresso for UI assertions, `evaluateJavascript()` for WebView DOM inspection, real server with test fixtures, `ssh2` Node.js library for local SSH test server.

**Rationale**: Real device testing catches issues that unit tests miss (WebView behavior, hardware detection, network connectivity). MockSigningBackend enables unattended execution.

**Best practices**:
- `@get:Rule val activityRule = ActivityScenarioRule(MainActivity::class.java)` for activity lifecycle management.
- WebView assertions via JavaScript bridge: `webView.evaluateJavascript("document.querySelector('.dashboard').textContent", callback)`.
- `IdlingResource` for WebView page load synchronization — register before navigation, unregister on `onPageFinished`.
- Custom `RunListener` writes structured JSON to `test-logs/` with screenshots on failure via `Screenshot.capture()`.
- Test SSH server: `ssh2.Server` with `hostKeys` from test keypair, `authentication` handler accepting test public key.
- `adb reverse tcp:3000 tcp:3000` for device-to-host connectivity.
- Test fixtures: template `projects.json` copied to temp `AGENT_RUNNER_DATA_DIR` per test scenario.

## 12. Node.js Custom Test Reporter

**Decision**: Node.js native test runner custom reporter API (`--test-reporter`) writing structured output to `test-logs/`.

**Rationale**: Native test runner supports custom reporters since Node 20. No additional dependency needed. Output format optimized for agent consumption — minimal on success, detailed on failure.

**Best practices**:
- Reporter implements `async *[Symbol.asyncIterator]()` consuming test events.
- `test:pass` → append one line to summary.
- `test:fail` → write full detail file to `failures/` with assertion diff, stack trace, and test name.
- `test:complete` → write `summary.json` with counts and failed test list.
- Register via `--test-reporter=./tests/helpers/test-reporter.ts --test-reporter-destination=test-logs/`.

## 13. Existing Codebase State

The codebase implements the system described in the spec but **has not been validated end-to-end**. Files exist and unit tests pass in isolation, but real user flows (onboarding, task runs, SSH bridge) have not been exercised. The code was generated by an agent that did not run integration tests or validate against a real server.

**Files exist but need fix-validate cycles**:
- Server with HTTP + WebSocket (raw `http` + `ws`)
- Project model, Session model, Task parser
- Process manager, Sandbox service, Session logger
- SSH agent bridge, SSH agent protocol parser
- Push notification service, Discovery service, Onboarding service
- Recovery service, Spec-kit service, Transcript parser
- Agent framework service, Flake generator, Disk monitor
- Config, Logger
- Full Preact PWA (7 screens), Service worker, Voice transcription
- Android app (WebView, Yubikey PIV — needs multi-key refactor)

**Test coverage**: 18 unit, 12 integration, 5 contract test files exist. Tests pass but may not reflect actual runtime behavior.

**Implication for planning**: Tasks must follow a fix-validate loop: run tests, read structured failure output, fix code, re-run until green. Then validate real user flows end-to-end. Android app needs multi-key architecture refactor and integration test infrastructure built from scratch.
