# Implementation Plan: Android Client

**Branch**: `006-android-client` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-android-client/spec.md`

## Summary

Build a native Android app (Kotlin) that replaces the browser PWA. The app uses a WebView to load the existing Preact UI and adds native Yubikey PIV support for SSH agent signing. Two WebSocket connections run simultaneously: the WebView's existing connection for UI streaming, and a native connection for SSH agent message relay. Yubikey communication uses Yubico's `yubikit-android` SDK.

## Technical Context

**Language/Version**: Kotlin, Android API 26+ (Android 8.0 Oreo)
**Primary Dependencies**: `yubikit-android` 3.0.1 (USB/NFC transport + PIV), Android WebView, `java-websocket` or OkHttp (native WebSocket)
**Storage**: Android SharedPreferences (server URL)
**Testing**: JUnit 5, Mockito/MockK for Yubikey mocking
**Target Platform**: Android 8.0+ (API 26), physical devices with USB-C and/or NFC
**Project Type**: Android app (single-activity, WebView + native overlay)
**Performance Goals**: Yubikey detection < 2 seconds, sign modal display < 500ms
**Constraints**: PIV signing requires physical Yubikey — cannot be tested on emulator. NFC is transient (tap-based, no persistent connection).
**Scale/Scope**: Single user, single server connection, 1 Yubikey at a time

## Constitution Check

*Note: The agent-runner constitution governs the server-side codebase. The Android app is a separate project. The constitution principles inform architectural decisions but don't directly gate this implementation.*

| Principle | Relevance | Notes |
|-----------|-----------|-------|
| I. Sandbox-First | N/A (client-side) | Server sandbox unchanged. App communicates via existing WebSocket protocol. |
| III. Thin Client | ALIGNED | App is a thin client — WebView loads existing UI, native layer only handles Yubikey. No decision logic in the app. |
| V. Simplicity & YAGNI | ALIGNED | Minimal native code. WebView reuses existing UI. No duplicated functionality. |

## Project Structure

### Documentation (this feature)

```text
specs/006-android-client/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── javascript-bridge.md
├── quickstart.md
└── tasks.md
```

### Source Code (separate repository/directory)

```text
android/
├── app/
│   ├── build.gradle.kts
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── kotlin/com/agentrunner/
│   │   │   ├── MainActivity.kt
│   │   │   ├── ServerConfigActivity.kt
│   │   │   ├── yubikey/
│   │   │   │   ├── YubikeyManager.kt
│   │   │   │   └── SshKeyFormatter.kt
│   │   │   ├── bridge/
│   │   │   │   ├── AgentWebSocket.kt
│   │   │   │   ├── SignRequestHandler.kt
│   │   │   │   └── SignRequestDialog.kt
│   │   │   └── config/
│   │   │       └── ServerConfig.kt
│   │   └── res/
│   │       ├── layout/
│   │       ├── values/
│   │       └── xml/
│   └── src/test/
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

**Structure Decision**: Single-module Android app. Kotlin packages organized by concern: `yubikey/` for hardware interaction, `bridge/` for WebSocket relay and sign request handling, `config/` for persistence. Single Activity with WebView — no fragments needed except the sign request dialog.

## Implementation Approach

### Phase 1: Project Setup

1. **Android project scaffold** — Gradle Kotlin DSL, dependencies (yubikit-android, piv, WebSocket library), AndroidManifest with USB/NFC permissions, min SDK 26.

### Phase 2: WebView Shell

2. **Main Activity** — WebView loading server URL, JavaScript enabled, WebSocket support. Handle URL hash monitoring via `WebViewClient.doUpdateVisitedHistory()` for session detection.

3. **Server config** — SharedPreferences persistence, first-launch config screen, settings access to change URL.

### Phase 3: Yubikey Integration

4. **YubikeyManager** — Wrap `YubiKitManager` for USB/NFC discovery. Expose `LiveData<YubikeyStatus>` for connection state. Implement `listKeys()` (read cert from slot 9a, convert to SSH wire format) and `sign()` (PIV raw sign via slot 9a).

5. **SshKeyFormatter** — Convert `X509Certificate` public key to SSH agent wire format (`IDENTITIES_ANSWER` response). Handle ECDSA P-256 key encoding.

### Phase 4: SSH Agent Bridge

6. **AgentWebSocket** — Native OkHttp/java-websocket connection to `/ws/sessions/<id>`. Filter for `ssh-agent-request` messages. Expose callbacks for sign requests.

7. **SignRequestHandler** — Queue incoming sign requests. Display `SignRequestDialog` for each. On Yubikey touch: sign data, send response. On cancel: send cancel. Handle multiple queued requests.

8. **SignRequestDialog** — Modal overlay showing operation context, Yubikey status, touch instruction, cancel button. Auto-dismiss on success/cancel.

### Phase 5: Integration & Polish

9. **Wire everything together** — MainActivity creates YubikeyManager, monitors URL hash for session changes, opens/closes AgentWebSocket, routes sign requests to handler.

10. **Yubikey status indicator** — Small overlay or status bar showing connection state. Update from `YubikeyManager.status` LiveData.

11. **Push notifications** — Register for web-push via the existing server API. Handle notification taps to navigate to correct session/project.

12. **Configuration survival** — Handle activity recreation (rotation, background/foreground) without losing WebView state or pending sign requests.
