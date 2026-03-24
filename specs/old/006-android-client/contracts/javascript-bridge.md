# JavaScript Bridge Contract: Android Client

## Native → WebView (via @JavascriptInterface)

The native layer exposes a minimal JavaScript interface for Yubikey status queries.

### Interface Name: `AgentRunner`

Accessible in WebView JavaScript as `window.AgentRunner`.

```javascript
// Check if running inside the Android app
window.AgentRunner !== undefined  // true in Android app, undefined in browser

// Get Yubikey connection status
window.AgentRunner.getYubikeyStatus()
// Returns: "disconnected" | "connected_usb" | "connected_nfc" | "error"

// Get Yubikey serial number (if connected)
window.AgentRunner.getYubikeySerial()
// Returns: "20569688" | "" (empty if not connected)
```

### Usage in PWA (optional enhancement)

The web app can optionally check for the bridge and show Yubikey status:

```javascript
if (window.AgentRunner) {
  const status = window.AgentRunner.getYubikeyStatus();
  // Show native Yubikey indicator
}
```

This is optional — the PWA works without it. The Android app shows its own native Yubikey status indicator regardless.

## WebView → Native (via URL hash monitoring)

The native layer monitors `WebViewClient.doUpdateVisitedHistory()` for URL changes:

- `#/sessions/<uuid>` → open native WebSocket to `/ws/sessions/<uuid>`
- Navigation away from session → close native WebSocket
- `#/` (dashboard) → no native WebSocket needed

No JavaScript bridge method needed for session discovery.
