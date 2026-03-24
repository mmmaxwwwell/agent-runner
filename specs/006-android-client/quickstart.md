# Quickstart: Android Client

## Prerequisites

- Android Studio (latest stable)
- JDK 17+
- Android SDK API 26+ (installed via Android Studio)
- A physical Android device with USB-C (for Yubikey testing — emulator won't work for USB/NFC)
- A Yubikey 5 NFC or similar with PIV key in slot 9a

## Project Setup

```bash
# The Android project lives in a separate directory (not inside agent-runner)
# It's a standalone Kotlin Android project

# Open in Android Studio
# File → Open → select the android/ directory

# Build
./gradlew assembleDebug

# Run tests
./gradlew test

# Install on device
./gradlew installDebug
```

## Key Dependencies

```gradle
// build.gradle.kts (app)
dependencies {
    implementation("com.yubico.yubikit:android:3.0.1")
    implementation("com.yubico.yubikit:piv:3.0.1")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")  // or OkHttp
}
```

## Testing

### WebView Testing
1. Start agent-runner server on your development machine
2. Note the IP (e.g., `192.168.1.100:3000`)
3. Install the Android app on a device on the same network
4. Enter the server URL on first launch
5. Verify dashboard loads and projects are visible

### Yubikey USB Testing
1. Connect Yubikey to Android device via USB-C
2. Grant USB permission when prompted
3. Verify status indicator shows "Yubikey connected"
4. Trigger a sign request (start a session on a project with SSH remote)
5. Verify sign modal appears
6. Touch Yubikey to authorize
7. Verify git push completes

### Yubikey NFC Testing
1. Start a session with SSH remote
2. When sign modal appears, tap Yubikey against back of phone
3. Verify signing completes

### Manual WebSocket Testing
```bash
# Verify server accepts multiple WebSocket connections per session
# Open two connections to the same session:
wscat -c ws://localhost:3000/ws/sessions/<sessionId>
# Both should receive output messages
```

## Architecture Overview

```
┌─────────────────────────────────────┐
│           Android App               │
├─────────────────────────────────────┤
│  ┌──────────────┐  ┌─────────────┐ │
│  │   WebView    │  │  Native WS  │ │
│  │  (PWA UI)    │  │ (SSH agent) │ │
│  │   ↕ WS #1   │  │   ↕ WS #2   │ │
│  └──────────────┘  └─────────────┘ │
│         │                  │        │
│  ┌──────────────┐  ┌─────────────┐ │
│  │  URL Hash    │  │  Yubikey    │ │
│  │  Monitor     │──│  Manager    │ │
│  └──────────────┘  └─────────────┘ │
│                    ┌─────────────┐  │
│                    │ Sign Modal  │  │
│                    └─────────────┘  │
└─────────────────────────────────────┘
         ↕                    ↕
┌─────────────────────────────────────┐
│        Agent-Runner Server          │
│  /ws/sessions/:id (both WS)        │
└─────────────────────────────────────┘
```
