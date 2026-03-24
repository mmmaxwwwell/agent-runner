# Research: Android Client

## Decision 1: Yubico yubikit-android SDK for PIV

**Decision**: Use `com.yubico.yubikit:android:3.0.1` + `com.yubico.yubikit:piv:3.0.1` for all Yubikey communication.

**Rationale**: Official SDK from Yubico. Handles USB and NFC transport uniformly — both produce `SmartCardConnection`, then `PivSession` is identical code. PIV module provides `getCertificate()` for key listing and `rawSignOrDecrypt()` for signing. JCA provider available for higher-level signing via standard `Signature.getInstance("SHA256withECDSA")`.

**Alternatives considered**:
- Hand-written APDU commands via Android USB/NFC APIs — error-prone, undocumented signing flows, no transport abstraction
- OpenSC/PKCS#11 via JNI — heavy, complex native dependency

## Decision 2: Separate Native WebSocket

**Decision**: Native Kotlin layer opens its own WebSocket connection to the session endpoint, independent of the WebView's connection.

**Rationale**: The server already supports multiple clients per session WebSocket. A separate native connection avoids complex WebView JS interception. The web app stays completely unmodified — no JavaScript bridge needed for SSH agent message handling. The native layer monitors WebView URL hash changes to detect which session to connect to.

**Alternatives considered**:
- WebView JS interception via `shouldInterceptRequest` — doesn't work for WebSocket upgrade requests
- JavaScript bridge (`@JavascriptInterface`) — requires modifying the web app code, couples native and web layers
- Single connection with message routing — adds complexity to the WebView layer

## Decision 3: Session Discovery via URL Hash Monitoring

**Decision**: Native layer monitors WebView URL hash changes (e.g., `#/sessions/<uuid>`) to detect the active session and open/close its WebSocket connection.

**Rationale**: The PWA uses hash-based routing. `WebViewClient.doUpdateVisitedHistory()` or `WebChromeClient.onReceivedTitle()` can detect navigation changes. No JS bridge needed for session discovery. When the user navigates to a session view, the native layer opens a WebSocket; when they navigate away, it closes.

**Alternatives considered**:
- JavaScript bridge for session ID — requires modifying web app, adds coupling
- Dashboard WebSocket for session discovery — indirect, delayed updates

## Decision 4: PIV Signing Approach

**Decision**: Use `PivSession.rawSignOrDecrypt(Slot.AUTHENTICATION, KeyType.ECCP256, data)` for signing. Use `PivSession.getCertificate(Slot.AUTHENTICATION)` for key listing.

**Rationale**: The SSH agent bridge sends raw data to sign. `rawSignOrDecrypt` takes raw data and returns the signature — maps directly to the SSH agent protocol's sign request. The JCA provider approach adds unnecessary abstraction for our use case (we're not doing standard TLS or certificate validation). PIN verification via `piv.verifyPin()` may be needed before signing depending on the slot's PIN policy.

**Alternatives considered**:
- JCA Provider (`PivProvider` + `KeyStore`) — adds complexity, designed for standard Java crypto use cases, not raw SSH signing

## Decision 5: Minimum Android SDK

**Decision**: API 26 (Android 8.0 Oreo).

**Rationale**: yubikit-android supports API 21+, but WebView WebSocket support is more reliable on API 26+. Android 8.0+ is widely deployed (99%+ of active devices). Notification channels (for push notifications, US5) require API 26.

**Alternatives considered**:
- API 21 (Lollipop) — SDK minimum, but older WebView versions have quirks
- API 29 (Android 10) — too restrictive, excludes still-active devices

## Decision 6: Project Structure

**Decision**: Standard Android project with Gradle. Kotlin. Single-module app.

**Rationale**: Single activity with WebView. Native Yubikey code is a handful of Kotlin classes. No need for multi-module structure. Gradle Kotlin DSL for build files.

## Yubico SDK Quick Reference

### Dependencies
```gradle
implementation 'com.yubico.yubikit:android:3.0.1'
implementation 'com.yubico.yubikit:piv:3.0.1'
```

### Key Classes
- `YubiKitManager` — USB/NFC discovery lifecycle
- `SmartCardConnection` — transport-agnostic connection
- `PivSession` — PIV applet operations
- `Slot.AUTHENTICATION` — slot 9a
- `KeyType.ECCP256` — ECDSA P-256

### PIV Operations
- List keys: `piv.getCertificate(Slot.AUTHENTICATION)` → `X509Certificate`
- Sign: `piv.verifyPin(pin)` then `piv.rawSignOrDecrypt(Slot.AUTHENTICATION, KeyType.ECCP256, data)`
- Metadata: `piv.getSlotMetadata(Slot.AUTHENTICATION)` → key type, policies

### PIN Handling
- **Default PIN**: `123456` (factory default)
- **Default PUK**: `12345678`
- **Slot 9a PIN policy**: `ONCE` (default) — PIN required once per smartcard session
- **Wrong PIN**: yubikit v3.0 throws `ApduException` with SW `0x63CX` where X = retries remaining
- **PIN blocked**: SW `0x6983` — no retries left, requires PUK unblock
- **PUK blocked**: only recovery is full PIV reset (destroys all keys)
- **PIN retries**: default 3 attempts before lockout
- **Session behavior**: each `SmartCardConnection` is a new session. PIN policy `ONCE` means PIN needed once per connection, not once per app lifetime
- **Caching strategy**: cache PIN in memory (char array, zeroed on app destroy). Avoids re-prompting on subsequent sign operations. Never persist to disk.
- **yubikey-agent note**: holds a persistent smartcard transaction, so PIN is effectively cached for the agent's lifetime. Our app opens fresh connections per operation, so we must cache PIN ourselves.

### Android Permissions (auto-merged from SDK)
- `android.permission.NFC` (normal, install-time)
- `android.hardware.usb.host` (feature, required=false)
- `android.hardware.nfc` (feature, required=false)
