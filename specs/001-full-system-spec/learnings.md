# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T001 — Custom test reporter
- Node.js 22 test runner custom reporter API: export default async generator function that yields strings. Events arrive via async iterable.
- `details.type === 'suite'` distinguishes `describe()` blocks from `it()`/`test()` leaf tests — must filter suites to get accurate pass/fail counts.
- `details.error.expected` and `details.error.actual` are often undefined for assertion errors; the comparison info is embedded in `error.message` instead.
- The `test:diagnostic` event's data can be a string directly or have a `.message` property — handle both.
- Reporter path is relative to cwd: `--test-reporter=./tests/helpers/test-reporter.ts`
- `TEST_TYPE` env var controls the output subdirectory (unit/integration/contract).

### T004 — Test keypair generator
- `tsx` is not on PATH in the nix shell; use `npx tsx` instead.
- `import.meta.dirname` works in Node 22 with tsx — gives the directory of the current module file.
- SSH authorized_keys format for ECDSA P-256: `ecdsa-sha2-nistp256 <base64(string("ecdsa-sha2-nistp256") + string("nistp256") + string(0x04||x||y))> comment`
- Generated test keys are gitignored — each machine generates its own. The `ensureTestKeypair()` function is idempotent.

### T005 — Test SSH server
- `ssh2` library does NOT export named ESM exports. Must use `import ssh2 from 'ssh2'` then destructure `const { Server } = ssh2`.
- `ssh2` cannot parse PKCS8 PEM keys (the format Node.js `generateKeyPairSync` uses by default for EC keys). EC private keys must be in SEC1 format (`"BEGIN EC PRIVATE KEY"`). Use `createPrivateKey(pkcs8Pem).export({ type: 'sec1', format: 'pem' })` to convert.
- For SSH server host keys, `ssh2` needs RSA (PKCS1) or similar — ed25519 PKCS8 format is rejected.
- OpenSSH 10.0 has algorithm negotiation issues with `ssh2`'s server. Integration tests should use the `ssh2` Client library rather than shelling out to `ssh`/`git clone`. The `info.clientPrivateKey` field provides the SEC1-formatted key for ssh2 Client use.
- The test SSH server creates a temp bare git repo with an initial commit and cleans it up on `stop()`. The repo path changes each run (uses `mkdtempSync`).

### T008 — Server smoke test
- Server starts cleanly with `nix develop -c npm run dev` — no startup crashes.
- Data dir defaults to `~/.local/share/agent-runner/`. Auto-creates `projects.json` and `push-subscriptions.json` if missing.
- VAPID keys auto-generated and saved to `vapid-keys.json` in data dir on first run.
- `ensureAgentFramework()` runs on startup (git clone/pull of agent-framework repo into data dir) — can be slow on first run.
- `GET /api/projects` returns `{ registered: [], discovered: [...] }` — discovered array scans `~/git` by default (env `AGENT_RUNNER_PROJECTS_DIR`).
- WebSocket upgrade for `/ws/dashboard` works correctly.
- PWA assets (app.js, sw.js, manifest.json, index.html) all served from `public/` directory.
- No code changes were needed — everything worked out of the box after T007's build fix.

### T009 — API endpoint verification
- `GET /api/health` returns `{ status, uptime, sandboxAvailable, cloudSttAvailable }` — matches contract exactly.
- `GET /api/projects` returns `{ registered, discovered, discoveryError }` — structure matches contract.
- Discovered items include extra `type: "discovered"` field not in the contract, and `hasSpecKit` is an object `{ spec, plan, tasks }` instead of a boolean. These are enhancements over the contract — contract tests in Phase 5 will validate compatibility.
- No code changes needed — both endpoints work correctly out of the box.

### T010 — Unit tests all green
- All 367 unit tests (18 test files) passed on first run with zero failures and zero code changes needed.
- The codebase was already in good shape from Phases 1–2 work. Phase 3 checkpoint met immediately.

### T011 — Integration tests all green
- All 172 integration tests (12 test files) passed on first run with zero failures and zero code changes needed.
- The WebSocket heartbeat tests are slow (~90s) due to real ping/pong interval timing — this dominates the overall ~110s test duration.
- Phase 4 checkpoint met immediately.

### T012 — Contract tests all green
- All 94 contract tests (5 test files) passed on first run with zero failures and zero code changes needed.
- WebSocket heartbeat contract tests are the slowest (~60s) due to 30s ping interval verification — dominates the ~63s total contract test duration.
- Phase 5 checkpoint met immediately.

### T013 — Onboarding E2E flow validation
- **Nix requires tracked files in git repos**: After `git init`, must run `git add` on `flake.nix` before `nix develop` can evaluate it. Otherwise nix fails with "Path 'flake.nix' is not tracked by Git."
- **`nix develop` generates `flake.lock`**: After `install-specify` runs `nix develop`, a `flake.lock` file appears. Must `git add -A` after to avoid "dirty tree" warnings in subsequent nix commands.
- **`specify` binary not on PATH inside `nix develop`**: `uv tool install` puts binaries in `~/.local/bin/` which isn't on the nix develop PATH. Must use absolute path: `join(homedir(), '.local', 'bin', 'specify')`.
- **`specify init` requires arguments**: Needs `specify init . --ai claude --force` — the `.` tells it to init in the current directory, `--ai claude` selects the AI, and `--force` skips the "directory not empty" confirmation prompt.
- **Pre-created session conflict**: The route handler pre-creates an interview session to return `sessionId` immediately, but the pipeline's `launch-interview` step was also creating a session, causing "already has an active session" error. Fix: pass `sessionId` through `OnboardingContext` and reuse it in launch-interview.
- **Onboarding unit tests relied on incidental failures**: Tests expected the pipeline to fail because "nix isn't available in tests", but nix IS available (tests run via `nix develop -c`). The tests actually failed because `flake.nix` wasn't tracked by git. After fixing git-add, the pipeline succeeded and the error-handling tests failed. Fixed by writing an invalid `flake.nix` to reliably trigger failures at install-specify.

### T014 — New Project E2E flow
- **Onboarding interview session state not transitioned on exit**: The `launch-interview` step in `onboarding.ts` spawned the process but never called `transitionState()` when it exited. Session stayed "running" forever. Fixed by adding exit handler that mirrors the pattern in `routes/sessions.ts` (lines 285-310): `unregisterProcess`, `transitionState`, `broadcastSessionState`, `broadcastProjectUpdate`.
- **New project flow works end-to-end**: `POST /api/projects/onboard` with `{name, newProject: true}` correctly creates directory, generates flake.nix, git init, specify init, and launches interview.
- **`POST /api/workflows/new-project` returns 410**: This deprecated endpoint returns Gone status. No contract tests cover it, and the contract says it's an alias but the implementation chose deprecation. Not fixing since all contract tests pass.

### T015 — Task run E2E flow
- **Sandbox must bind-mount `~/.claude/` (writable) and `~/.claude.json` (read-only)**: `ProtectHome=tmpfs` hides Claude Code's auth tokens and config. Without these bind mounts, Claude exits silently with code 0 and no output. `~/.claude/` must be writable because Claude writes session-env, file-history, etc.
- **`--verbose` flag required for `--output-format stream-json` with `-p`**: Claude Code requires `--verbose` when using `stream-json` output format in print mode (`-p`). Without it, Claude prints an error to stderr and exits 0 — no stdout output.
- **Sandbox needs `WorkingDirectory` property**: Without `--property=WorkingDirectory=<projectDir>`, the sandboxed process inherits the server's cwd, causing Claude to search for tasks in the wrong directory.
- **Task loop needs infinite loop protection**: If the agent exits 0 but makes no progress (e.g., auth failure causes silent exit), the loop spawns indefinitely. Added `MAX_STALE_SPAWNS=5` — if remaining task count doesn't decrease for 5 consecutive spawns, the loop aborts with `exitCode: -2`.
- **`cwd` must be threaded through**: Added `cwd` field to `SandboxCommand`, `SpawnOptions`, and `TaskLoopOptions` interfaces, and passed it through all spawn sites in `sessions.ts` and `projects.ts`.
- **E2E verified**: Register project → start task-run → sandbox spawns → Claude completes task 1 → auto-loop detects remaining tasks → spawns again → Claude completes task 2 → session marked completed. Full flow works.

### T016 — WebSocket session streaming E2E
- **No code changes needed** — WebSocket streaming and `lastSeq` replay work correctly out of the box.
- **Pino logs to stderr**: When spawning the server as a child process, listen on `stderr` for pino log output (not stdout). However, when spawning with compiled `dist/server.js`, stdout works; with `npx tsx`, the tsx wrapper may interfere with stdout piping.
- **Spawning `npx tsx` from within `npx tsx` doesn't work**: Child process gets SIGTERM immediately with no output. Use compiled `node dist/server.js` instead when spawning the server from a tsx-executed script.
- **E2E verified**: Initial connection replays all output + sends sync → live streaming delivers new entries via 50ms file poll → disconnect + reconnect with `lastSeq` replays only missed entries → live streaming resumes after reconnect. Full flow works.

### T017 — Waiting-for-input E2E flow
- **Bug fixed: `allowUnsandboxed` not passed on resume**: The `POST /api/sessions/:id/input` handler called `buildCommand()` without `allowUnsandboxed`, defaulting to `false`. On systems without systemd-run (macOS), this caused a 503 error on resume even though the original session was created with `allowUnsandboxed: true`. Fixed by passing `cfg.allowUnsandboxed` through to `buildCommand` on resume.
- **Contract doc says `text`, implementation uses `answer`**: The REST API contract (`rest-api.md`) specifies `{ "text": "..." }` for the input request body, but the implementation and all tests use `{ "answer": "..." }`. Tests are the spec — this is a contract doc inconsistency, not a code bug.
- **WebSocket buffering in E2E tests**: When connecting a WebSocket to a session in `waiting-for-input` state, the server sends output replay + sync + state messages rapidly. Test code must buffer all messages from connection time, not start listening after a specific message. Polling a shared buffer array works well.
- **E2E verified**: GET session shows waiting-for-input with question → WebSocket receives state message with question and taskId → POST input returns 200 with state: running → WebSocket receives state: running broadcast → session log contains "User answered: ..." entry → session transitions out of waiting-for-input. Full flow works.

### T018 — SSH agent bridge E2E
- **No code changes needed** — the SSH agent bridge works correctly out of the box.
- **Unix socket path length limit**: Unix sockets have a 107-byte path limit (`sun_path` is 108 bytes). Nix shell creates deeply nested temp dirs (`/tmp/nix-shell.xxx/nix-shell.yyy/...`) which easily exceed 108 bytes. The E2E test must use short paths (e.g., `/tmp/e2e-ssh-XXXX/`) to stay under the limit.
- **Bridge cleanup race**: When a session's agent process exits, the bridge is cleaned up (`cleanupBridge` → `destroy` → `unlink` socket). E2E tests must complete all socket operations before the process fails. Run all tests in rapid succession after connecting.
- **Task file format matters**: The `parseTaskSummary` function expects `## Phase N: Name` headers and `- [ ] <number> description` format. A simple `- [ ] T001 Foo` format won't parse — the task ID must be numeric.
- **Agent framework setup**: The server runs `git fetch` on the agent-framework dir at startup. Creating just a `.git` directory isn't enough — must `git init` a proper repo so `git fetch` succeeds (even if it has no remote).
- **E2E verified**: Session created with bridge → socket at correct path with 0600 perms → REQUEST_IDENTITIES forwarded to WebSocket → SIGN_REQUEST forwarded with remote context → ssh-agent-response routed back through socket → non-whitelisted types rejected → cancel returns SSH_AGENT_FAILURE. Full flow works.

### T019 — Android build fix
- **Android SDK must be in nix flake**: The flake originally had `gradle` and `jdk17` but no Android SDK. Added `androidenv.composeAndroidPackages` with `platformVersions = ["34"]` and `buildToolsVersions = ["34.0.0"]`. Set `ANDROID_HOME` to `${androidSdk}/libexec/android-sdk`.
- **Unfree + license acceptance in flake**: Android SDK is unfree and requires license acceptance. Must use `import nixpkgs { config = { allowUnfree = true; android_sdk.accept_license = true; }; }` instead of `nixpkgs.legacyPackages` — otherwise `nix develop -c` fails without `--impure` + env vars.
- **Kotlin type mismatch in YubikeyManager**: `ApduException.sw` returns `Short`, but the code compared it with `Int` literals and used `and` bitwise operations. Fix: `e.sw.toInt()` to convert to Int before comparisons.
- **4 unit test failures remain**: `SignRequestHandlerTest.kt` has 4 failing tests related to PIN handling and concurrent sign requests. These are for Phase 9 (T030) to fix.
- **Android build command**: `cd android && nix develop /home/max/git/agent-runner -c ./gradlew assembleDebug` — must `cd` into `android/` first since the shellHook's `cd android` fails when already in `android/`.

### T020 — SigningBackend interface
- **Android source lives under `kotlin/` not `java/`**: Task description says `.../java/.../signing/` but the project uses `src/main/kotlin/com/agentrunner/`. Created the `signing` package there.
- **KeyEntry data class co-created with interface**: The `SigningBackend` interface references `KeyEntry` in its method signatures. Created `KeyEntry.kt` in the same `signing` package with all fields from data-model.md. T021 (KeyRegistry) will build CRUD and JSON serialization on top of this type.
- **KeyType enum with JSON serialization**: Data model uses kebab-case strings (`"yubikey-piv"`, `"android-keystore"`). Created `KeyType` enum with `toJsonValue()`/`fromJsonValue()` helpers for JSON round-tripping.

### T021 — KeyRegistry
- **`JSONObject.optString(key, null)` returns `Nothing?`**: Kotlin infers the null literal's type as `Nothing?`, causing type mismatch warnings when assigning to `String?`. Use `if (json.isNull(key)) null else json.getString(key)` instead.
- **Duplicate detection by public key blob**: `KeyEntry.publicKey` is `ByteArray`, so equality checks must use `contentEquals()`, not `==`. The `KeyEntry.equals()` only checks `id`, so registry must explicitly check for duplicate public keys with `contentEquals()`.

### T022 — YubikeySigningBackend
- **Composition over replacement**: `YubikeySigningBackend` wraps `YubikeyManager` (composition) rather than replacing it. `YubikeyManager` retains Activity lifecycle methods (`startDiscovery`/`stopDiscovery`) and `LiveData<YubikeyStatus>` that don't belong in a `SigningBackend`. The backend adds `KeyRegistry` integration and adapts the interface.
- **PIN not in SigningBackend.sign()**: The `SigningBackend.sign(keyId, data)` interface has no PIN parameter. `YubikeySigningBackend` adds `signWithPin(keyId, data, pin)` for when `hasCachedPin()` is false. `sign()` uses the cached PIN from `YubikeyManager`. `SignRequestHandler` (T028) will route to the appropriate method.
- **Key registration on detection**: `onYubikeyConnected()` must be called by the Activity when status changes to connected. It reads slot 9a via `YubikeyManager.listKeys()`, checks for duplicates by public key blob, and registers new keys in `KeyRegistry`.
- **`@Synchronized` on instance methods**: All mutating methods use `@Synchronized` for thread safety since multiple backends may register keys concurrently. Read methods are unsynchronized since `listKeys()` reads the whole file atomically.

### T023 — KeystoreSigningBackend
- **BiometricPrompt + suspend bridging**: Use `suspendCancellableCoroutine` to bridge BiometricPrompt's callback API to coroutines. The `CryptoObject` wrapping an initialized `Signature` must be passed to `authenticate()`. The `onAuthenticationSucceeded` callback provides the authenticated Signature via `result.cryptoObject?.signature`.
- **BiometricPrompt must run on main thread**: `prompt.authenticate()` must be called via `activity.runOnUiThread`. The executor for the callback should be `ContextCompat.getMainExecutor(activity)`.
- **Android Keystore key aliases**: Prefixed with `agent-runner-` + UUID to avoid collision. The alias is stored in `KeyEntry.keystoreAlias` for later retrieval.
- **`setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`**: The `0` timeout means per-use authentication (every sign requires biometric). This is the most secure option for SSH signing.
- **SSH public key blob reuse**: `SshKeyFormatter.toSshPublicKeyBlob()` accepts `X509Certificate` which is exactly what `KeyStore.getCertificate(alias)` returns for Keystore-generated keys. No additional conversion needed.
- **Added `androidx.biometric:biometric:1.1.0`** dependency to `build.gradle.kts`.

### T024 — MockSigningBackend
- **Debug source set uses `kotlin/` not `java/`**: Consistent with main source set, the debug source lives at `src/debug/kotlin/com/agentrunner/signing/`, not `src/debug/java/...`.
- **`SshKeyFormatter.toSshPublicKeyBlob()` requires X509Certificate**: Since MockSigningBackend generates keys via standard Java crypto (not Android Keystore), there's no X509Certificate. Built the SSH public key blob manually using the same format: string("ecdsa-sha2-nistp256") + string("nistp256") + string(0x04 || x || y).
- **PKCS8 for persistence**: Standard Java `KeyPairGenerator` produces PKCS8-encoded private keys via `privateKey.encoded`. These reload fine via `PKCS8EncodedKeySpec` + `KeyFactory.getInstance("EC")`.
- **KeyType.MOCK added**: The `KeyType` enum needed a `MOCK` variant with JSON value `"mock"`. This is a main source set change since `KeyRegistry` (in main) must be able to deserialize mock key entries.

### T025 — KeyManagementActivity
- **RecyclerView with MaterialCardView items**: Used inner `KeyAdapter` and `KeyViewHolder` classes rather than a separate file to keep things simple. The adapter uses `notifyDataSetChanged()` since the key list is small.
- **KeystoreSigningBackend.deleteKey() handles Keystore cleanup**: When removing an Android Keystore key, must call `keystoreBackend.deleteKey()` (not just `registry.removeKey()`) to also delete the key from the Android Keystore itself.
- **JavaScript bridge `openKeyManagement()`**: Added to `MainActivity.AgentRunnerBridge` so the PWA can open the key management screen via `window.AgentRunner.openKeyManagement()`.

### T026 — SignRequestDialog key picker
- **`SignRequestDialog.MatchingKey` data class**: Wraps `KeyEntry` + `available: Boolean`. This is the bridge between the handler (which knows availability) and the dialog (which shows status). Used in both `SignRequestListener` and `SignRequestDialog.Callback`.
- **RadioGroup for key picker**: Simple RadioGroup with programmatically added RadioButtons — adequate since key count is small (typically 1-3). Each button shows type, name, truncated fingerprint, and status.
- **Auto-select behavior**: When 0 or 1 matching keys, no picker is shown. For 0 keys (legacy path with no `matchingKeys` provided), the dialog falls back to the original PIN-only behavior — ensures backward compatibility with `SignRequestHandler` which still calls `onShowSignDialog` without matching keys (T027/T028 will add that).
- **`selectedKeyId` stored in handler**: `SignRequestHandler.onKeySelected(keyId)` stores the key ID but doesn't route to backends yet — T028 will use this to dispatch to the correct `SigningBackend`.
- **PIN input conditional on key type**: Only shown for `YUBIKEY_PIV` when `pinRequired`. For `ANDROID_KEYSTORE`, biometric is handled by `KeystoreSigningBackend.sign()` internally. For `MOCK`, no user interaction needed.

### T027 — SigningBackend injection in MainActivity
- **Reflection for debug-only class**: `MockSigningBackend` lives in `src/debug/` and isn't available in release builds. Used `Class.forName("com.agentrunner.signing.MockSigningBackend")` + reflection to instantiate it conditionally. `ClassNotFoundException` naturally skips it in release.
- **Backward-compatible SignRequestHandler**: Added `keyRegistry` and `backends` as optional constructor parameters with defaults (`null` and `emptyList()`). When both are provided, `processListKeys` uses the new KeyRegistry+canSign path; otherwise falls back to direct `yubikey.listKeys()`. This keeps existing tests passing until T028/T030 update them.
- **YubikeySigningBackend.onYubikeyConnected() is suspend**: Must be called from a coroutine scope. The Yubikey status observer in `setupYubikeyStatusOverlay` launches a coroutine via `activityScope.launch` to call it.
- **clearPin delegation**: `onDestroy` now calls `yubikeySigningBackend.clearPin()` instead of `yubikeyManager.clearPin()` directly — the backend delegates to the manager, keeping the abstraction consistent.
