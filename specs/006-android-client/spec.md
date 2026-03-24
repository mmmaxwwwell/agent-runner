# Feature Specification: Android Client

**Feature Branch**: `006-android-client`
**Created**: 2026-03-23
**Status**: Draft
**Input**: Native Android app replacing the browser PWA — WebView for UI + native Yubikey PIV bridge for SSH agent signing

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Dashboard and Manage Projects (Priority: P1)

A user opens the Android app and sees the same dashboard as the browser PWA — registered projects with task progress, discovered directories with onboard buttons, and active session status. The app loads the existing Preact web UI in a WebView, connecting to the agent-runner server. All existing functionality (onboarding, interviews, session viewing, settings) works exactly as it does in the browser.

**Why this priority**: The app must be a functional replacement for the browser PWA before adding native features. If the WebView doesn't work, nothing else matters.

**Independent Test**: Install the app, configure the server URL. Verify the dashboard loads, projects are displayed, and onboarding/interview flows work identically to the browser.

**Acceptance Scenarios**:

1. **Given** the app is installed and the server URL is configured, **When** the app opens, **Then** the dashboard loads in the WebView showing registered and discovered projects.
2. **Given** the user navigates to a project detail page, **When** they view sessions and task progress, **Then** the display is identical to the browser PWA.
3. **Given** the user starts an onboarding flow, **When** the interview chat loads, **Then** WebSocket streaming works (output appears, user can send input).
4. **Given** the server is unreachable, **When** the app opens, **Then** a clear error message is shown with the option to configure the server URL.

---

### User Story 2 - Authorize SSH Sign Requests via Yubikey (Priority: P1)

When the agent-runner server sends an `ssh-agent-request` WebSocket message (from 005-ssh-agent-bridge), the app displays a modal showing what is being signed (e.g., "Sign for git push to github.com:user/repo.git"). The user touches their Yubikey (connected via USB-C or NFC) to authorize. The app's native layer talks PIV to the Yubikey, signs the data, and sends the response back over WebSocket. The user can also cancel the request.

**Why this priority**: This is the core native feature — the reason the app exists instead of just using a browser. Without Yubikey signing, there's no value over the PWA.

**Independent Test**: Connect a Yubikey via USB-C. Trigger a sign request from the server (mock or real git push). Verify the modal appears with correct context, Yubikey touch completes the signing, and the response reaches the server.

**Acceptance Scenarios**:

1. **Given** the app receives an `ssh-agent-request` WebSocket message with `messageType: 13` (sign), **When** the message is received, **Then** a modal overlay appears showing the operation context (e.g., "Sign for git push to github.com:user/repo.git") with a Cancel button.
2. **Given** the sign modal is displayed, **When** the user touches their Yubikey (USB-C or NFC), **Then** the native layer performs the PIV signing operation and sends an `ssh-agent-response` WebSocket message with the base64-encoded signed data.
3. **Given** the sign modal is displayed, **When** the user taps Cancel, **Then** an `ssh-agent-cancel` WebSocket message is sent and the modal closes.
4. **Given** the Yubikey is not connected, **When** a sign request arrives, **Then** the modal shows the request context and a message indicating no Yubikey is detected. The user can connect one and retry, or cancel.
5. **Given** a key listing request (`messageType: 11`), **When** the app receives it, **Then** the native layer queries the Yubikey for public keys and responds automatically without showing a modal (no touch required for key listing).

---

### User Story 3 - Yubikey Detection and Status (Priority: P2)

The app detects when a Yubikey is connected (USB-C) or tapped (NFC) and shows its status in the UI — a small indicator showing "Yubikey connected" or "No Yubikey". This provides feedback so the user knows their key is ready before a sign request arrives.

**Why this priority**: UX polish. Users need to know their Yubikey is detected before they can authorize operations. Without this, they'd only discover connection issues when a sign request fails.

**Independent Test**: Launch the app with no Yubikey. Verify "No Yubikey" indicator. Connect a Yubikey via USB-C. Verify indicator changes to "Yubikey connected" with serial number. Remove it. Verify indicator returns to "No Yubikey".

**Acceptance Scenarios**:

1. **Given** no Yubikey is connected, **When** the app is open, **Then** a status indicator shows "No Yubikey detected".
2. **Given** a Yubikey is connected via USB-C, **When** the app detects it, **Then** the indicator shows "Yubikey connected" with the device serial number.
3. **Given** a Yubikey is connected, **When** it is removed, **Then** the indicator updates to "No Yubikey detected" within 2 seconds.
4. **Given** a Yubikey is tapped via NFC, **When** the app detects it, **Then** the indicator briefly shows "Yubikey detected (NFC)" for the duration of the NFC session.

---

### User Story 4 - Server URL Configuration (Priority: P2)

The user can configure which agent-runner server the app connects to. The URL is persisted across app restarts. On first launch, the app prompts for the server URL before loading anything.

**Why this priority**: The app needs to know where the server is. Without this, the WebView can't load and no WebSocket connections can be established.

**Independent Test**: First launch — verify URL prompt appears. Enter URL. Verify dashboard loads. Close and reopen app. Verify it reconnects to the same URL without prompting.

**Acceptance Scenarios**:

1. **Given** first app launch with no saved URL, **When** the app opens, **Then** a configuration screen prompts for the server URL.
2. **Given** a valid URL is entered, **When** the user confirms, **Then** the WebView loads the dashboard from that URL and the URL is persisted.
3. **Given** a saved URL exists, **When** the app opens, **Then** it connects to the saved URL automatically.
4. **Given** the user wants to change the server, **When** they access settings, **Then** they can update the URL and reconnect.

---

### User Story 5 - Push Notifications (Priority: P3)

The app receives push notifications from the agent-runner server (using the existing web-push infrastructure) for session events — task completion, session failures, input needed. Tapping a notification opens the app to the relevant session or project.

**Why this priority**: Nice-to-have. The browser PWA already supports push notifications. The Android app should too, but it's not blocking for the core Yubikey functionality.

**Independent Test**: Subscribe to push notifications. Complete a task run. Verify notification received. Tap notification. Verify app opens to the correct project.

**Acceptance Scenarios**:

1. **Given** the app is in the background, **When** a session completes or needs input, **Then** a push notification appears.
2. **Given** the user taps a push notification, **When** the app opens, **Then** it navigates to the relevant project or session view.

---

### Edge Cases

- What happens when the Yubikey is disconnected mid-signing (USB cable pulled during PIV operation)? The app should detect the disconnection, send `ssh-agent-cancel` to the server, and show an error to the user.
- What happens when NFC connection is lost during signing (user moves phone away from Yubikey)? Same — cancel and show error.
- What happens when multiple sign requests arrive simultaneously? Queue them and show one modal at a time, processing in order.
- What happens when the WebSocket disconnects while a sign modal is open? Dismiss the modal and show a connection error. When reconnected, pending sign requests are not replayed (server already timed them out).
- What happens when the server URL is invalid or the server is down? Show a clear error with retry option. Don't crash.
- What happens when the Yubikey's PIV applet returns an error (wrong PIN, locked key)? Show the error in the sign modal. Allow retry or cancel.
- What happens when the app is killed by Android while a sign request is pending? The server times out after 60 seconds and returns FAILURE to the agent.
- What happens when the user enters the wrong PIN? Show error with remaining retries (PIV allows 3 attempts before lockout). Allow re-entry.
- What happens when the PIN is blocked (3 failed attempts)? Show clear error that the key is locked. The user must use `ykman piv access unblock-pin` externally to recover. Cancel the sign request.

## Requirements *(mandatory)*

### Functional Requirements

#### WebView Shell

- **FR-001**: The app MUST load the agent-runner PWA in an Android WebView, connecting to the configured server URL.
- **FR-002**: The WebView MUST support WebSocket connections (for session streaming and SSH agent relay).
- **FR-003**: The native layer MUST open its own WebSocket connection to the same session endpoint as the WebView, handling SSH agent messages natively. The WebView's web app remains unmodified.
- **FR-004**: All existing PWA functionality (dashboard, onboarding, interview chat, session view, settings) MUST work identically in the WebView.

#### Yubikey PIV Integration

- **FR-005**: The app MUST detect Yubikey devices connected via USB-C using Android's `android.hardware.usb` API.
- **FR-006**: The app MUST detect Yubikey devices via NFC using Android's `android.nfc` API.
- **FR-007**: The app MUST communicate with the Yubikey's PIV applet using Yubico's `yubikit-android` SDK (PIV module) for signing operations and key listing.
- **FR-008**: For `ssh-agent-request` messages with `messageType: 13` (sign), the app MUST extract the data to be signed, present the Yubikey for signing via PIV, and return the signed result.
- **FR-009**: For `ssh-agent-request` messages with `messageType: 11` (list keys), the app MUST query the Yubikey's PIV slot 9a for the public key and respond automatically (no user interaction required).
- **FR-010**: The PIV signing operation MUST use the key in slot 9a (authentication slot). The key type MUST be detected at runtime via `getSlotMetadata()`. Initially only ECDSA P-256 is supported — other key types MUST return a clear error message.
- **FR-010a**: Before signing, the app MUST check whether the PIV PIN is required (slot 9a default policy is `ONCE` — PIN required once per smartcard session). Since each sign request may open a fresh `SmartCardConnection`, the app MUST prompt for PIN on the first sign operation and cache it in memory for subsequent operations within the app's lifecycle.
- **FR-010b**: The PIN MUST be cached in memory only (cleared on app destruction). It MUST NOT be persisted to disk, SharedPreferences, or logs. The PIN character array MUST be zeroed after use.
- **FR-010c**: If PIN verification fails (wrong PIN), the app MUST show the error with remaining retry count (extracted from `ApduException` SW `0x63CX` where X = retries remaining) and allow re-entry. If the PIN is blocked (SW `0x6983`, 0 retries), the app MUST show a clear error indicating the key is locked and requires PUK unblock via `ykman piv access unblock-pin`.
- **FR-010d**: The sign modal MUST show a PIN input field when PIN is required and no cached PIN is available. After successful verification, subsequent sign requests skip the PIN prompt (PIN cached in memory).

#### Sign Request Modal

- **FR-011**: When a sign request arrives, the app MUST display a modal overlay on top of the WebView showing: the operation context string from the server, a Cancel button, and an instruction to touch the Yubikey.
- **FR-012**: The modal MUST remain visible until the Yubikey touch completes, the user cancels, or the request times out.
- **FR-013**: If no Yubikey is connected when a sign request arrives, the modal MUST show a "Connect Yubikey" message and wait for one to be connected.
- **FR-014**: Multiple sign requests MUST be queued and displayed one at a time.

#### Server Configuration

- **FR-015**: The app MUST persist the server URL in Android SharedPreferences.
- **FR-016**: On first launch (no saved URL), the app MUST show a configuration screen before loading the WebView.
- **FR-017**: The server URL MUST be editable from the app's settings.

#### JavaScript Bridge

- **FR-018**: The native layer MUST monitor WebView URL hash changes to detect the active session ID (e.g., `#/sessions/<uuid>`) and open/close its own WebSocket connection accordingly.
- **FR-019**: The native layer MUST expose a JavaScript interface (`@JavascriptInterface`) to the WebView for Yubikey status queries (connected/disconnected, serial number) so the web app can display status indicators if needed.
- **FR-020**: SSH agent WebSocket messages (`ssh-agent-request`, `ssh-agent-response`, `ssh-agent-cancel`) MUST be handled by the native layer's own WebSocket connection to the session endpoint. The web app's JavaScript does not process these messages.

### Key Entities

- **YubikeyManager**: Native Kotlin class managing USB/NFC Yubikey detection, PIV applet communication, and signing operations.
- **SignRequestModal**: Native Kotlin dialog/fragment overlaid on the WebView showing sign request context and Yubikey touch prompt.
- **WebViewBridge**: JavaScript interface exposed to the WebView for native ↔ web communication.
- **ServerConfig**: Persisted server URL and connection settings in SharedPreferences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Android app loads the PWA dashboard and all existing features work identically to the browser.
- **SC-002**: A git push from a sandboxed agent triggers a sign modal on the Android app, and Yubikey touch completes the push.
- **SC-003**: Key listing requests are handled automatically without user interaction.
- **SC-004**: The Yubikey status indicator reflects connection state within 2 seconds of USB connect/disconnect.
- **SC-005**: The app survives configuration changes (rotation, background/foreground) without losing WebView state or pending sign requests.
- **SC-006**: If the Yubikey is disconnected during signing, the request is cancelled gracefully (no crash, no hang).

## Clarifications

### Session 2026-03-23

- Q: How does the native layer access SSH agent WebSocket messages? → A: Native layer opens a separate WebSocket connection to the same session endpoint, handles SSH agent messages natively. WebView's web app stays unmodified.
- Q: Yubico SDK or hand-written APDU for PIV communication? → A: Yubico's `yubikit-android` SDK — official PIV module handles APDU, USB/NFC transport, and signing.
- Q: How does the native layer discover which session to connect to? → A: Monitor WebView URL hash changes to detect the current session (e.g., `#/sessions/uuid`).
