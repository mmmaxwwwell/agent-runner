## Code Review: 006-android-client (Kotlin/Android)

**Scope**: 40 files changed, +3024/-30 lines | **Base**: `12cc486` (post 005-ssh-agent-bridge review)
**Commits**: T001–T030 — Android project scaffold, WebView shell, Yubikey PIV signing, push notifications, lifecycle polish
**Stack**: Kotlin + Android API 26+ + YubiKit 3.0.1 (PIV) + OkHttp (WebSocket) + AndroidX

### Findings

| # | Sev | Category | File:Line | Finding | Suggested fix | Confidence |
|---|-----|----------|-----------|---------|---------------|------------|
| 1 | P1 | Correctness | SignRequestHandler.kt:228 | `buildSignatureBlob()` wraps the raw DER-encoded ECDSA signature from `rawSignOrDecrypt()` directly as the SSH signature blob. SSH agent protocol (RFC draft-miller-ssh-agent) requires ECDSA signatures to be encoded as `mpint r \|\| mpint s`, not DER (ASN.1 SEQUENCE of two INTEGERs). The server bridge (`handleResponse`) passes bytes through unchanged to the SSH client socket. All sign operations will produce malformed signatures that SSH clients reject. | Parse the DER signature to extract r and s INTEGER values, then encode each as an SSH mpint (4-byte big-endian length + value with leading 0x00 if high bit set) and concatenate them as the inner signature blob. | 95 |
| 2 | P2 | Resource Leak | MainActivity.kt:52 | `activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)` is never cancelled. `onDestroy()` disconnects the WebSocket and nulls the handler, but doesn't cancel the scope's Job. Any in-flight coroutines (e.g., `processSign` waiting on `pinChannel.receive()` or `withTimeout`) will leak and continue running after Activity destruction. | Add `activityScope.cancel()` at the top of `onDestroy()`, before disconnecting the WebSocket. | 85 |

### Summary

- **P0**: 0 critical issues
- **P1**: 1 high issue — DER-to-SSH signature format conversion missing
- **P2**: 1 medium issue — CoroutineScope leak on Activity destroy

### What looks good

The Yubikey integration is well-structured: PIN caching with proper zeroing on destroy, APDU error parsing for retries/blocked states, and clean separation between YubikeyManager (hardware), SignRequestHandler (orchestration), and SignRequestDialog (UI). The WebSocket reconnect with exponential backoff and the sign request queue with FIFO processing are solid patterns. The DialogFragment/Activity callback split handles rotation correctly.
