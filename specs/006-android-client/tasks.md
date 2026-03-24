# Tasks: Android Client

**Input**: Design documents from `/specs/006-android-client/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests included where meaningful. Note: PIV signing requires a physical Yubikey and cannot be unit-tested with mocks alone — integration tests require a real device.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Android project scaffold and dependency configuration

- [x] T001 Create Android project with Gradle Kotlin DSL — root build.gradle.kts, settings.gradle.kts, gradle.properties. Set min SDK 26, target SDK 34, Kotlin 1.9+. Add dependencies: `com.yubico.yubikit:android:3.0.1`, `com.yubico.yubikit:piv:3.0.1`, OkHttp (for native WebSocket). Configure mavenCentral repository
- [x] T002 Create AndroidManifest.xml — declare MainActivity as launcher, declare ServerConfigActivity, add INTERNET permission, USB/NFC features (required=false). Set app theme and icon
- [x] T003 [P] Create string resources in app/src/main/res/values/strings.xml — app name, server config labels, sign modal text, Yubikey status messages, error messages

**Checkpoint**: Project builds and installs on device (empty app)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server config persistence and WebView shell — all user stories depend on these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational Phase

- [x] T004 [P] Write tests for ServerConfig in app/src/test/kotlin/com/agentrunner/config/ServerConfigTest.kt — test save/load from SharedPreferences, test null when no saved URL, test URL validation

### Implementation for Foundational Phase

- [x] T005 Implement ServerConfig in app/src/main/kotlin/com/agentrunner/config/ServerConfig.kt — persist server URL in SharedPreferences, `load()` returns null on first launch, `save()` writes URL, basic URL validation (starts with http:// or https://)
- [x] T006 Implement ServerConfigActivity in app/src/main/kotlin/com/agentrunner/ServerConfigActivity.kt — layout with URL text field and Connect button (app/src/main/res/layout/activity_server_config.xml). Validate URL on submit, save via ServerConfig, launch MainActivity with URL as intent extra
- [x] T007 Implement MainActivity WebView shell in app/src/main/kotlin/com/agentrunner/MainActivity.kt — load server URL from ServerConfig (or intent extra). Create WebView with JavaScript enabled, DOM storage enabled, WebSocket support. Load server URL in WebView. Handle back button for WebView navigation. If no saved URL, redirect to ServerConfigActivity

**Checkpoint**: App launches, shows config on first run, loads PWA dashboard in WebView

---

## Phase 3: User Story 1 — View Dashboard and Manage Projects (Priority: P1) 🎯 MVP

**Goal**: WebView loads existing PWA and all features work identically to browser

**Independent Test**: Install app, enter server URL. Verify dashboard, onboarding, interview chat all work.

### Implementation for User Story 1

- [x] T008 [US1] Configure WebView settings for full PWA compatibility in app/src/main/kotlin/com/agentrunner/MainActivity.kt — enable JavaScript, DOM storage, allow mixed content (for local dev HTTP), set user agent to include "AgentRunner-Android", handle SSL errors gracefully for dev, set WebChromeClient for console.log forwarding to Logcat
- [x] T009 [US1] Add URL hash monitoring in MainActivity via WebViewClient.doUpdateVisitedHistory() — parse URL hash to detect session navigation (e.g., `#/sessions/<uuid>`). Store current sessionId. Log navigation changes for debugging
- [x] T010 [US1] Handle connectivity errors in WebView — override WebViewClient.onReceivedError() and onReceivedHttpError(). Show user-friendly error page with retry button and option to change server URL. Handle server unreachable scenario
- [x] T011 [US1] Add settings access from WebView — expose a way to return to ServerConfigActivity to change server URL (e.g., JavaScript bridge method `window.AgentRunner.openSettings()` or long-press app icon)

**Checkpoint**: PWA works identically in WebView. Navigation detected. Errors handled.

---

## Phase 4: User Story 2 — Authorize SSH Sign Requests via Yubikey (Priority: P1)

**Goal**: Sign requests from server trigger modal, Yubikey touch completes signing

**Independent Test**: Connect Yubikey. Trigger sign request from server. Verify modal, touch, and response.

### Tests for User Story 2

- [ ] T012 [P] [US2] Write tests for SshKeyFormatter in app/src/test/kotlin/com/agentrunner/yubikey/SshKeyFormatterTest.kt — test converting ECDSA P-256 X509Certificate public key to SSH wire format (string "ecdsa-sha2-nistp256" + string "nistp256" + string point), test generating SSH IDENTITIES_ANSWER response bytes
- [ ] T013 [P] [US2] Write tests for SignRequestHandler in app/src/test/kotlin/com/agentrunner/bridge/SignRequestHandlerTest.kt — test request queuing (second request waits until first completes), test cancel sends ssh-agent-cancel message, test timeout handling, test Yubikey disconnected during signing sends cancel, test that messageType 11 (list keys) is auto-responded via YubikeyManager.listKeys() WITHOUT showing SignRequestDialog, test PIN prompt shown on first sign (no cached PIN), test PIN cached after successful verification (no re-prompt), test wrong PIN shows error with retries remaining, test PIN blocked shows locked error and cancels request

### Implementation for User Story 2

- [ ] T014 [US2] Implement YubikeyManager in app/src/main/kotlin/com/agentrunner/yubikey/YubikeyManager.kt — wrap YubiKitManager. startDiscovery/stopDiscovery for USB and NFC. Expose LiveData<YubikeyStatus> for connection state. On USB connect: store device reference, set onClosed callback. On NFC tap: handle transient connection. Cache PIN as char array in memory (never persist, zero on destroy). Implement `suspend fun listKeys()`: open SmartCardConnection, create PivSession, getCertificate(Slot.AUTHENTICATION), convert to SshPublicKey. Implement `suspend fun sign(data: ByteArray, pin: CharArray?)`: open connection, check key type via `getSlotMetadata(Slot.AUTHENTICATION).keyType` — only support ECCP256 initially (return clear error for other types). Call verifyPin(pin) — on success cache PIN for subsequent calls. On ApduException SW 0x63CX: throw with retries remaining. On SW 0x6983: throw PIN blocked error. Then rawSignOrDecrypt(Slot.AUTHENTICATION, KeyType.ECCP256, data). Implement `fun clearPin()` to zero cached PIN array
- [ ] T015 [US2] Implement SshKeyFormatter in app/src/main/kotlin/com/agentrunner/yubikey/SshKeyFormatter.kt — convert X509Certificate ECDSA P-256 public key to SSH wire format. Build SSH_AGENT_IDENTITIES_ANSWER (type 12) response: uint32 nkeys=1, string key_blob (SSH-encoded public key), string comment ("YubiKey PIV Slot 9a")
- [ ] T016 [US2] Implement AgentWebSocket in app/src/main/kotlin/com/agentrunner/bridge/AgentWebSocket.kt — OkHttp WebSocket connecting to `ws://<serverUrl>/ws/sessions/<sessionId>`. Parse incoming JSON messages, filter for `type: "ssh-agent-request"`. Expose callback `onSignRequest`. Implement `sendResponse(requestId, data)` encoding data as base64 JSON. Implement `sendCancel(requestId)`. Handle reconnection with exponential backoff
- [ ] T017 [US2] Implement SignRequestHandler in app/src/main/kotlin/com/agentrunner/bridge/SignRequestHandler.kt — queue incoming SignRequests. For messageType 11 (list keys): auto-respond via YubikeyManager.listKeys() without showing modal. For messageType 13 (sign): show SignRequestDialog. On Yubikey touch: decode base64 data from request, extract the data-to-sign from the SSH agent message, call YubikeyManager.sign(), encode response as SSH_AGENT_SIGN_RESPONSE (type 14), send via AgentWebSocket. On cancel: send ssh-agent-cancel. On Yubikey disconnect during sign: auto-cancel
- [ ] T018 [US2] Implement SignRequestDialog in app/src/main/kotlin/com/agentrunner/bridge/SignRequestDialog.kt — DialogFragment overlaid on WebView. Layout (app/src/main/res/layout/dialog_sign_request.xml): operation context text, PIN input field (shown when no cached PIN available, hidden after successful verification), Yubikey status text ("Enter PIN and touch Yubikey" / "Touch Yubikey to authorize" / "Connect Yubikey"), Cancel button. Show PIN error with retries remaining on wrong PIN. Show "Key locked" error on PIN blocked (SW 0x6983). Observe YubikeyManager.status LiveData to update status text. Auto-dismiss on sign completion or cancel. Non-cancellable by back press (must use Cancel button)
- [ ] T019 [US2] Wire sign request flow in MainActivity — when URL hash changes to a session: create AgentWebSocket, connect. Set onSignRequest callback to route to SignRequestHandler. When URL hash changes away from session: disconnect AgentWebSocket. Create YubikeyManager in onCreate, start/stop discovery in onResume/onPause

**Checkpoint**: Full sign flow works — request arrives, modal shows, Yubikey touch signs, response sent back

---

## Phase 5: User Story 3 — Yubikey Detection and Status (Priority: P2)

**Goal**: Visual indicator showing Yubikey connection state

**Independent Test**: No Yubikey → shows "No Yubikey". Connect USB → shows "Connected". Remove → updates.

### Implementation for User Story 3

- [ ] T020 [US3] Add Yubikey status indicator overlay in MainActivity — small floating view or status bar at top/bottom of WebView showing connection state. Observe YubikeyManager.status LiveData. Show serial number when connected. Animate NFC tap detection. Update within 2 seconds of connect/disconnect
- [ ] T021 [US3] Expose Yubikey status via JavaScript bridge in MainActivity — add @JavascriptInterface class `AgentRunnerBridge` with `getYubikeyStatus()` returning "disconnected"/"connected_usb"/"connected_nfc" and `getYubikeySerial()` returning serial or empty string. Add to WebView via `addJavascriptInterface(bridge, "AgentRunner")`

**Checkpoint**: User can see Yubikey connection state at all times

---

## Phase 6: User Story 4 — Server URL Configuration (Priority: P2)

**Goal**: Persist server URL, prompt on first launch, editable in settings

**Independent Test**: First launch shows URL prompt. Enter URL. Reopen app connects automatically.

### Implementation for User Story 4

- [ ] T022 [US4] Handle app lifecycle for server config in MainActivity — in onCreate: check ServerConfig.load(). If null: start ServerConfigActivity, finish(). If URL exists: load WebView. Handle returned result from config activity
- [ ] T023 [US4] Add settings navigation — add menu option or button accessible from WebView (via JavaScript bridge `window.AgentRunner.openSettings()` or native toolbar) that launches ServerConfigActivity for URL editing. Pre-populate current URL in the edit field

**Checkpoint**: Server URL persists and is configurable

---

## Phase 7: User Story 5 — Push Notifications (Priority: P3)

**Goal**: Receive push notifications, tap to navigate to session/project

**Independent Test**: Subscribe to push. Complete a task. Verify notification. Tap to navigate.

### Implementation for User Story 5

- [ ] T024 [US5] Register for web-push from native layer — call POST /api/push/subscribe from native code using the server's VAPID public key. Store subscription in SharedPreferences. Handle notification display via Android NotificationManager with notification channel
- [ ] T025 [US5] Handle notification tap navigation — on notification tap: launch MainActivity with deep link intent containing project/session URL hash. MainActivity loads WebView and navigates to the correct hash route

**Checkpoint**: Push notifications work and deep-link to correct views

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Robustness, lifecycle handling, edge cases

- [ ] T026 [P] Handle activity recreation (rotation, backgrounding) in MainActivity — save/restore WebView state, current sessionId, AgentWebSocket connection state. Ensure sign modal survives rotation (DialogFragment handles this). Re-establish WebSocket on activity restore
- [ ] T027 [P] Handle Yubikey disconnect mid-signing — in YubikeyManager, detect USB onClosed during active sign operation. In SignRequestHandler, auto-cancel pending request and show error in modal. Handle NFC loss during signing similarly
- [ ] T028 [P] Handle multiple queued sign requests — in SignRequestHandler, ensure queue is processed FIFO. Show count badge on modal ("Request 1 of 3"). Cancel all pending on WebSocket disconnect
- [ ] T029 Handle WebSocket disconnect during sign modal — dismiss modal, show connection error toast, fail pending requests. On reconnect, pending sign requests are NOT replayed (server already timed out)
- [ ] T030 Add ProGuard/R8 rules for Yubico SDK in app/proguard-rules.pro — ensure yubikit classes are not minified. Add keep rules for @JavascriptInterface methods

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 WebView Shell (Phase 3)**: Depends on Foundational
- **US2 Yubikey Signing (Phase 4)**: Depends on US1 (needs WebView + URL hash monitoring)
- **US3 Yubikey Status (Phase 5)**: Depends on US2 (needs YubikeyManager)
- **US4 Server Config (Phase 6)**: Depends on Foundational (mostly already done in Phase 2, this phase adds lifecycle polish)
- **US5 Push Notifications (Phase 7)**: Depends on US1 (needs WebView + server connection)
- **Polish (Phase 8)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — WebView MVP
- **US2 (P1)**: Depends on US1 — needs session detection from URL hash
- **US3 (P2)**: Depends on US2 — needs YubikeyManager
- **US4 (P2)**: Mostly done in Foundational — lifecycle polish
- **US5 (P3)**: Depends on US1 — independent of Yubikey features

### Parallel Opportunities

- T003 (strings) can run in parallel with T001/T002
- T004 (config tests) can run in parallel with other setup
- T012, T013 (US2 tests) can run in parallel
- T026, T027, T028 (polish) can run in parallel

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T007)
3. Complete Phase 3: US1 — WebView shell (T008-T011)
4. Complete Phase 4: US2 — Yubikey signing (T012-T019)
5. **STOP and VALIDATE**: Test full flow — dashboard in WebView, git push triggers sign modal, Yubikey touch completes push

### Incremental Delivery

1. Setup + Foundational → App installs and shows config
2. Add US1 → PWA works in WebView
3. Add US2 → Yubikey signing works
4. Add US3 → Yubikey status visible
5. Add US4 → Config lifecycle polished
6. Add US5 → Push notifications
7. Polish → Rotation, disconnect handling, edge cases

---

## Notes

- PIV signing requires a physical Yubikey — integration tests must run on a real device
- NFC connections are transient — signing must complete quickly before NFC field is lost
- PIN may be required for PIV slot 9a depending on PIN policy — handle PIN prompt in YubikeyManager
- SSH wire format for ECDSA P-256 keys: string "ecdsa-sha2-nistp256" + string "nistp256" + string EC point (uncompressed)
- The web app (PWA) is NOT modified — all native functionality is additive
