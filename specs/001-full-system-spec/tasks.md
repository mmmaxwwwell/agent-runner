# Tasks: Agent Runner — Full System Specification

**Input**: Design documents from `/specs/001-full-system-spec/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/, quickstart.md

**Approach**: Fix-validate loop. Code exists but has never been run end-to-end. Each phase: run tests → read `test-logs/` failures → fix code (not tests — tests are the spec) → re-run until green. Then validate real flows.

**Constitution VII compliance**: For existing code (Phases 2–6), the fix-validate loop treats existing tests as the spec — fix code until tests pass. For new code (Phases 1, 8–11), tests MUST be written first and fail before implementation per Constitution VII.

**Manual validation only**: FR-018–FR-021 (voice client: continuous recognition, interim results, mic toggle, silence timeout) require browser + microphone and cannot be automated. Validate manually after Phase 6.

**Tests**: YES — FR-082 through FR-116 require comprehensive test coverage with structured test log output.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: Test Infrastructure

**Purpose**: Build the test log reporter and fix tooling before fixing anything else. Without structured test output, the fix-validate loop can't work.

- [x] T001 Implement custom Node.js test reporter in `tests/helpers/test-reporter.ts`: consume native test runner events, write `summary.json` + `failures/<test-name>.log` to `test-logs/<type>/<timestamp>/`. Pass = one line. Fail = assertion details + stack trace + context per FR-111–FR-114
- [x] T002 [P] Update `package.json` test scripts to use custom reporter: `npm test` passes `--test-reporter=./tests/helpers/test-reporter.ts`, add `test:unit`, `test:integration`, `test:contract` subscripts per FR-114
- [x] T003 [P] Create test fixture templates in `tests/fixtures/`: `projects-empty.json`, `projects-with-active.json`, `projects-with-onboarding.json`. Each is a valid `projects.json` for different test scenarios per FR-108
- [x] T004 [P] Implement test keypair generator in `tests/helpers/test-keypair.ts`: idempotently generate ECDSA P-256 keypair, store in `tests/fixtures/`, export in SSH authorized_keys format per FR-109
- [x] T005 [P] Implement test SSH server in `tests/helpers/test-ssh-server.ts`: Node.js `ssh2` server accepting the test public key, serving a local bare git repo, start/stop helpers for integration tests per FR-109. Add `ssh2` as dev dependency
- [x] T006 [P] Add `test-logs/` to `.gitignore`

---

## Phase 2: Smoke Test — Server Boots and PWA Loads

**Purpose**: Confirm the most basic thing works before diving into test suites

**⚠️ CRITICAL**: If the server won't start or the PWA won't load, nothing else matters

- [x] T007 Run `nix develop -c npm run build` and fix all TypeScript compilation errors until clean build
- [x] T008 Run `nix develop -c npm run dev`, hit `http://localhost:3000` in a browser, fix until the PWA dashboard loads and shows discovered directories. Fix any server startup crashes, missing routes, WebSocket connection failures, or client rendering errors
- [ ] T009 Verify `GET /api/health` returns 200 with correct fields. Verify `GET /api/projects` returns registered + discovered arrays. Fix any routing or handler issues

**Checkpoint**: Server starts, PWA loads, basic API works

---

## Phase 3: Fix All Node.js Unit Tests

**Purpose**: Bottom-up — ensure every service, model, route, and utility works correctly in isolation

- [ ] T010 Run `nix develop -c npm run test:unit` and make all unit tests pass. Read `test-logs/unit/` for failures, fix code (not tests — tests are the spec), re-run until green. This covers all 18 unit test files: config, logger, project, session, task-parser, session-logger, process-manager, sandbox, discovery, onboarding, flake-generator, agent-framework, spec-kit, transcript-parser, ssh-agent-protocol, ssh-agent-bridge, push, disk-monitor per FR-082–FR-086

**Checkpoint**: All unit tests green

---

## Phase 4: Fix All Node.js Integration Tests

**Purpose**: Validate multi-component workflows work together

- [ ] T011 Run `nix develop -c npm run test:integration` and make all integration tests pass. Read `test-logs/integration/` for failures, fix code, re-run until green. This covers all 12 integration test files: session-lifecycle, task-loop, process-manager, onboard-api, discovery-api, add-feature-workflow, dashboard-api, websocket, ssh-agent-bridge, recovery, voice-api, session-stop per FR-087–FR-095

**Checkpoint**: All integration tests green

---

## Phase 5: Fix All Node.js Contract Tests

**Purpose**: Validate API contracts match the spec

- [ ] T012 Run `nix develop -c npm run test:contract` and make all contract tests pass. Read `test-logs/contract/` for failures, fix code, re-run until green. This covers all 5 contract test files: rest-api, rest-api-projects, rest-api-add-feature, rest-api-voice, websocket-api per rest-api.md and websocket-api.md

**Checkpoint**: All contract tests green, API matches spec

---

## Phase 6: End-to-End User Flow Validation (Node.js)

**Purpose**: Actually exercise the real flows that have never worked. Run the server, hit endpoints, verify the full chain.

- [ ] T013 [US3] Start server with `npm run dev`. Use the PWA to onboard a discovered directory. Verify the full pipeline: register → optional remote setup UI (provide URL or `gh repo create` per FR-056) → generate flake → git init → specify init → interview session launches. After interview completes, verify project description is updated in `projects.json` per FR-058. Fix until the entire flow completes without errors per FR-052–FR-058
- [ ] T014 [US4] Start server. Use the PWA "New Project" flow — enter a name, verify directory creation, optional remote setup UI per FR-056, initialization, and interview session launch. After interview completes, verify project description updated per FR-058. Fix per FR-052, FR-056–FR-058
- [ ] T015 [US1] Register a project with a task list. Start a task run via the API. Verify: sandboxed process spawns, tasks are worked on, auto-loop continues when unchecked tasks remain, session completes when all tasks done per FR-003–FR-006
- [ ] T016 [US2] While a task run is active, connect to `/ws/sessions/:id` and verify live output streaming. Disconnect, reconnect with `lastSeq`, verify replay per FR-008
- [ ] T017 [US6] Run a project with a task that triggers `[?]`. Verify: session transitions to waiting-for-input, push notification sent. Submit input via API, verify session resumes per FR-006, FR-009
- [ ] T018 [US9] Start a session for a project with an SSH remote. Verify: Unix socket created at correct path, `SSH_AUTH_SOCK` set in sandbox. Send a mock SSH sign request through the socket, verify it arrives on the WebSocket as `ssh-agent-request` per FR-059–FR-065

**Checkpoint**: All core user flows work end-to-end on the server

---

## Phase 7: Android Build Fix

**Purpose**: Get the Android app compiling before any feature work

- [ ] T019 [US10] Run `./gradlew assembleDebug` in `android/` and fix all compilation errors until clean build. Update dependencies, fix Kotlin/Gradle version mismatches, ensure ProGuard/R8 rules are correct per FR-068

**Checkpoint**: Android debug APK builds successfully

---

## Phase 8: Android Multi-Key Architecture Refactor

**Purpose**: Refactor from single-Yubikey to multi-key signing with interface-based injection

- [ ] T020 [P] [US10] Create `SigningBackend` interface in `android/app/src/main/java/.../signing/SigningBackend.kt`: `suspend fun listKeys(): List<KeyEntry>`, `suspend fun sign(keyId: String, data: ByteArray): ByteArray`, `fun canSign(keyEntry: KeyEntry): Boolean` per FR-104
- [ ] T021 [P] [US10] Create `KeyRegistry` in `android/app/src/main/java/.../signing/KeyRegistry.kt`: read/write `keys.json` from app-private storage, CRUD operations for `KeyEntry`, export public key in SSH authorized_keys format per FR-098, data-model.md KeyEntry
- [ ] T022 [US10] Refactor `YubikeyManager.kt` into `YubikeySigningBackend.kt` implementing `SigningBackend`: USB/NFC detection, PIV slot 9a, ECDSA P-256 signing, PIN management, register key to `KeyRegistry` on detection per FR-070–FR-075, FR-104
- [ ] T023 [P] [US10] Implement `KeystoreSigningBackend.kt` in `android/app/src/main/java/.../signing/`: generate ECDSA P-256 keypair in Android Keystore, sign with `BiometricPrompt` gate (optional setting, default enabled), SSH signature format wrapping, register key to `KeyRegistry` per FR-101–FR-102, FR-104, research.md §10
- [ ] T024 [P] [US10] Implement `MockSigningBackend.kt` in `android/app/src/debug/java/.../signing/`: auto-sign with idempotently-generated test ECDSA P-256 keypair, no user interaction, register test key to `KeyRegistry` per FR-105
- [ ] T025 [US10] Create `KeyManagementActivity.kt` in `android/app/src/main/java/.../`: list registered keys (name, type, fingerprint, last used), add Yubikey (detect + read), generate app key, remove/rename keys, export public key to clipboard per FR-099
- [ ] T026 [US10] Refactor `SignRequestDialog.kt` to support key picker: auto-select if one key matches, show picker if multiple, show key status indicators (ready/connect Yubikey/unavailable), PIN prompt for Yubikey, biometric prompt for app keys per FR-103, FR-076
- [ ] T027 [US10] Update `MainActivity.kt` to inject `SigningBackend` implementations based on build type (debug includes Mock, release does not). Update type 11 handler to query `KeyRegistry` for currently-available keys only per FR-100, FR-104
- [ ] T028 [US10] Update `AgentWebSocket.kt` to use `SigningBackend` interface for sign requests: match requested key blob against `KeyRegistry`, route to correct backend, handle response/cancel per FR-069
- [ ] T029 [US10] Run `./gradlew assembleDebug` and fix until clean build with new architecture

**Checkpoint**: Android app builds with multi-key architecture, debug flavor has MockSigningBackend

---

## Phase 9: Android Unit Tests

**Purpose**: Verify the refactored signing architecture works correctly

- [ ] T030 [US10] Make all existing Android unit tests pass: `SignRequestHandlerTest.kt`, `ServerConfigTest.kt`, `SshKeyFormatterTest.kt`. Update tests to work with new `SigningBackend` interface. Run `./gradlew testDebugUnitTest`, fix until green
- [ ] T031 [P] [US10] Write unit tests for `KeyRegistry` in `android/app/src/test/.../KeyRegistryTest.kt`: CRUD operations, JSON serialization, SSH key format export, duplicate detection per FR-098
- [ ] T032 [P] [US10] Write unit tests for `KeystoreSigningBackend` in `android/app/src/test/.../KeystoreSigningBackendTest.kt`: key generation, signing produces valid ECDSA P-256 SSH signatures, biometric gate behavior per FR-101–FR-102
- [ ] T033 [P] [US10] Write unit tests for `MockSigningBackend` in `android/app/src/test/.../MockSigningBackendTest.kt`: idempotent keypair generation, deterministic signing, auto-register in KeyRegistry per FR-105
- [ ] T034 [US10] Run `./gradlew testDebugUnitTest`, fix until all unit tests green

**Checkpoint**: All Android unit tests pass

---

## Phase 10: Android Integration Test Infrastructure

**Purpose**: Build the ADB-based integration test harness

- [ ] T035 [US10] Implement custom JUnit `RunListener` in `android/app/src/androidTest/java/.../helpers/TestRunListener.kt`: write structured results to device storage, capture screenshots on UI failure, filter logcat on any failure, write `summary.json` per FR-115
- [ ] T036 [P] [US10] Implement `MockBiometricPrompt.kt` in `android/app/src/androidTest/java/.../helpers/`: auto-succeed biometric authentication for unattended testing per FR-110
- [ ] T037 [P] [US10] Create test fixture `projects.json` templates in `android/app/src/androidTest/assets/test-fixtures/`: matching server-side fixtures for scenario initialization per FR-108
- [ ] T038 [US10] Implement integration test orchestration script as `npm run test:android:integration` (shell script at `tests/android-integration/run.sh`): start real agent-runner server with test fixtures in temp data dir, `adb reverse tcp:3000 tcp:3000`, install debug test APK, run instrumented tests via `adb shell am instrument`, pull `test-logs/` from device, tear down server per FR-107
- [ ] T039 [US10] Verify orchestration script runs end-to-end (even if tests fail) — the pipeline itself must work

**Checkpoint**: Android integration test infrastructure works, can run tests on device

---

## Phase 11: Android Integration Tests

**Purpose**: Write and pass the actual on-device integration tests

- [ ] T040 [US10] Write `WebViewDashboardTest.kt` in `android/app/src/androidTest/java/.../`: app launches, WebView loads PWA from server, dashboard renders with project list (DOM inspection via `evaluateJavascript`), navigation to project detail works per FR-068, FR-106
- [ ] T041 [US10] Write `SignRequestFlowTest.kt` in `android/app/src/androidTest/java/.../`: mock server sends `ssh-agent-request` over WebSocket, sign modal appears with correct context, MockSigningBackend auto-signs, `ssh-agent-response` sent back, modal dismisses per FR-072, FR-103, FR-106
- [ ] T042 [US10] Write `SshBridgeEndToEndTest.kt` in `android/app/src/androidTest/java/.../`: full loop — test SSH server running on host, server starts session with project pointing to test bare repo, real `git push` via real `ssh` (both available in nix flake) triggers SSH auth through the bridge socket, server relays to Android over WebSocket, MockSigningBackend signs, response flows back, push succeeds to local bare repo per FR-109
- [ ] T043 [US10] Write `KeyManagementTest.kt` in `android/app/src/androidTest/java/.../`: open key management, add app key (verify keypair generated), verify key appears in list, export public key, remove key, verify removed per FR-099
- [ ] T044 [US10] Run `npm run test:android:integration` and make all Android integration tests pass. Read `test-logs/android-integration/` for failures, fix code, re-run until green

**Checkpoint**: All Android integration tests pass on device

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across the full system

- [ ] T045 [P] Run `nix develop -c npm test` and verify ALL Node.js tests pass (unit + integration + contract) with exit code 0 per FR-096
- [ ] T046 [P] Run `nix develop -c npm run build` and verify clean build with no TypeScript errors
- [ ] T047 [P] Verify `UI_FLOW.md` reflects all current screens, routes, and flows including key management per FR-080–FR-081
- [ ] T048 Run full system validation: start server, onboard a project, run tasks, trigger SSH bridge flow with Android app connected, verify the complete lifecycle works end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Test Infrastructure)**: No dependencies — start immediately
- **Phase 2 (Smoke Test)**: Can start in parallel with Phase 1 (doesn't need reporter yet)
- **Phase 3 (Unit Tests)**: Depends on Phase 1 (needs reporter) and Phase 2 (needs server buildable)
- **Phase 4 (Integration Tests)**: Depends on Phase 3 (unit-level code must be correct first)
- **Phase 5 (Contract Tests)**: Depends on Phase 3 (services must work)
- **Phase 6 (E2E Flows)**: Depends on Phases 4 and 5 (tests should be green before manual validation)
- **Phase 7 (Android Build)**: Can start after Phase 1 (independent of Node.js fixes)
- **Phase 8 (Android Refactor)**: Depends on Phase 7 (must build first)
- **Phase 9 (Android Unit Tests)**: Depends on Phase 8 (refactored code must exist)
- **Phase 10 (Android Test Infra)**: Depends on Phase 5 (test SSH server, fixtures) and Phase 9 (test patterns established)
- **Phase 11 (Android Integration)**: Depends on Phase 6 (server must work) and Phase 10 (test infra must work)
- **Phase 12 (Polish)**: Depends on all previous phases

### Parallel Opportunities

- Phase 1 and Phase 2 can run in parallel
- Phase 7 (Android Build) can start as soon as Phase 1 is done, parallel with Node.js Phases 3–6
- Within Phase 1: T002–T006 are all parallel (different files)
- Within Phase 8: T020, T021, T023, T024 are parallel (different files)
- Within Phase 9: T031–T033 are parallel (different test files)
- Within Phase 10: T036–T037 are parallel
- Within Phase 12: T045–T047 are parallel

### Optimal Two-Agent Strategy

- **Agent A (Node.js)**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
- **Agent B (Android)**: Phase 7 → Phase 8 → Phase 9 → Phase 10 (waits for Agent A Phase 6) → Phase 11
- **Both**: Phase 12

---

## Implementation Strategy

### Fix-Validate Loop (Every Phase)

1. Run the relevant test command
2. Read `test-logs/` for structured failure output
3. Fix the code (not the tests — tests are the spec)
4. Re-run tests
5. Repeat until green
6. Move to next phase

### MVP (Phases 1–6)

Server works, all Node.js tests pass, all user flows validated end-to-end. Android not yet touched.

### Full System (Phases 1–12)

Server + Android app + multi-key signing + integration tests all passing.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are the spec — when tests fail, fix the code, not the tests
- Exception: if a test is genuinely wrong (tests behavior the spec doesn't require), fix the test with a comment explaining why
- The test log infrastructure is the foundation — without it, the fix-validate loop is blind
- `ssh2` is added as a dev dependency for the test SSH server
- Android `MockSigningBackend` lives in `app/src/debug/` so it's available in dev AND test builds but stripped from release
