# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T001 — Android project scaffold decisions
- AGP 8.2.2 + Kotlin 1.9.22 + Gradle 8.5 — these versions are compatible. AGP 8.2 requires Gradle 8.2+.
- JVM target set to 17 (required by AGP 8.2+).
- Used `dependencyResolutionManagement` in settings.gradle.kts with `FAIL_ON_PROJECT_REPOS` to centralize repository declarations.
- AndroidX lifecycle, appcompat, material, and webkit are included as base dependencies. `webkit` is useful for advanced WebView features.
- Test framework: JUnit 4 + MockK (not JUnit 5 — Android test runner has better JUnit 4 support out of the box).
- Empty directories for package structure (yubikey/, bridge/, config/) are created but won't be tracked by git until files are added in later tasks.
- The android/ directory is at the repo root level, separate from the Node.js server code.

### T002 — AndroidManifest.xml decisions
- Used `Theme.Material3.DayNight.NoActionBar` — relies on the Material 1.11.0 dependency from T001. NoActionBar since WebView will be fullscreen.
- `usesCleartextTraffic="true"` is needed for local dev (HTTP to localhost). Production should use HTTPS but this flag doesn't hurt.
- `configChanges="orientation|screenSize|keyboardHidden"` on MainActivity prevents WebView from being destroyed on rotation (WebView state loss is painful).
- Created adaptive icon resources (mipmap-anydpi-v26) with a placeholder vector foreground. Replace with real icon later.
- Added minimal `strings.xml` with just `app_name` — T003 will add the rest. This is needed for the manifest `@string/app_name` reference to resolve.

### T004 — ServerConfig test conventions
- SharedPreferences name: `"agent_runner_prefs"`, key: `"server_url"`. T005 must use these exact strings.
- `ServerConfig.isValidUrl()` is a static validation method — tests expect it on the companion object.
- `load()` returns null for both missing key AND empty string — T005 should handle both cases.
- MockK `relaxed = true` on the editor avoids needing to stub every chained builder method.

### T005 — ServerConfig implementation
- No Gradle wrapper (`gradlew`) exists in the project yet — can't run unit tests from CLI. Future tasks that need to verify tests will need to either add the wrapper or verify manually.
- `isValidUrl()` trims whitespace before checking — this means `"   "` correctly returns false.
- `removePrefix` chain works because a URL can only start with one of the two prefixes, so the other `removePrefix` is a no-op.

### T006 — ServerConfigActivity
- `EXTRA_SERVER_URL` constant defined in `ServerConfigActivity.companion` — use `ServerConfigActivity.EXTRA_SERVER_URL` from MainActivity to read the intent extra.
- Activity uses `FLAG_ACTIVITY_CLEAR_TOP or FLAG_ACTIVITY_NEW_TASK` when launching MainActivity to avoid stacking duplicate activities.
- Pre-populates the URL field from `ServerConfig.load()` so users can edit an existing URL (important for T023 settings navigation).

### T007 — MainActivity WebView shell
- WebView is created programmatically (no XML layout) — `setContentView(webView)` makes it fill the screen. This works well with the NoActionBar theme from T002.
- `configChanges` in manifest (set in T002) prevents activity recreation on rotation, so WebView state is preserved without save/restore in most cases. `onSaveInstanceState` is still implemented as a safety net for low-memory kills.
- Intent extra from ServerConfigActivity takes priority over SharedPreferences — this ensures a freshly-entered URL is used immediately without a round-trip through prefs.
- `onBackPressed()` is deprecated but still the simplest way to intercept back for WebView navigation. T008+ tasks that add more WebView features should build on this class.

### T009 — URL hash monitoring
- `doUpdateVisitedHistory()` is called for hash changes (unlike `shouldOverrideUrlLoading()` which only fires for full navigations). This is the right callback for SPA hash-based routing.
- `Uri.parse(url).fragment` returns the fragment WITHOUT the leading `#`, so the regex needs to prepend `#` when matching against `SESSION_HASH_PATTERN`.
- `currentSessionId` is exposed as a `var` with `private set` so T019 (AgentWebSocket wiring) can read it to know which session to connect to.
- UUID pattern `[0-9a-fA-F\-]{36}` matches standard UUID format (8-4-4-4-12 with hyphens = 36 chars).

### T008 — WebView PWA compatibility settings
- `MIXED_CONTENT_ALWAYS_ALLOW` is needed for local dev where server runs on HTTP. This allows mixed content loading.
- User agent is appended with "AgentRunner-Android" (not replaced) so the PWA can detect native context via `navigator.userAgent.includes("AgentRunner-Android")`.
- Did NOT override `onReceivedSslError` to auto-proceed — Google Play rejects apps that bypass SSL validation. SSL errors show the default WebView error page, which is correct behavior.
- `WebChromeClient.onConsoleMessage()` forwards JS console output to Logcat under tag "AgentRunner", mapping console levels to Log levels.
- `onReceivedError` is logged but only for main frame requests to avoid noise from subresource failures. T010 will add the user-facing error page with retry button.

### T010 — WebView error handling
- WebView is now wrapped in a `FrameLayout` container (instead of `setContentView(webView)` directly) to allow overlaying the error view. T019+ tasks that add overlays (e.g., Yubikey status, sign modal) should use `webView.parent as FrameLayout` to add views.
- `serverUrl` was promoted from a local `val` to a class-level `var` so the retry button can reload it. Tasks that need the current server URL can access `serverUrl`.
- `onReceivedHttpError` fires for all HTTP status codes >= 400. Only main frame errors trigger the error overlay.
- `onPageFinished` hides the error view — this handles the case where a retry succeeds.
- Error view layout is at `res/layout/view_error.xml`.

### T011 — JavaScript bridge for settings access
- `AgentRunnerBridge` is an `inner class` of MainActivity so it can call `runOnUiThread` and `startActivity` via `this@MainActivity`. `@JavascriptInterface` methods run on a WebView background thread, so `runOnUiThread` is required for UI/Activity operations.
- The bridge is registered as `"AgentRunner"` — accessible in JS as `window.AgentRunner.openSettings()`. This matches the contract in `contracts/javascript-bridge.md`.
- T021 will extend this same bridge class with `getYubikeyStatus()` and `getYubikeySerial()` methods.

### T012 — SshKeyFormatter test API surface
- Tests expect two static methods on `SshKeyFormatter`: `toSshPublicKeyBlob(cert: X509Certificate): ByteArray` and `buildIdentitiesAnswer(cert: X509Certificate, comment: String): ByteArray`.
- `toSshPublicKeyBlob` must produce: SSH string "ecdsa-sha2-nistp256" + SSH string "nistp256" + SSH string (65-byte uncompressed EC point: 0x04 + 32-byte X + 32-byte Y). Coordinates must be zero-padded to exactly 32 bytes.
- `buildIdentitiesAnswer` must produce: byte 12 (SSH_AGENT_IDENTITIES_ANSWER) + uint32 nkeys=1 + SSH string key_blob + SSH string comment.
- Tests use real JDK-generated ECDSA P-256 keys with MockK-mocked X509Certificate (just `cert.publicKey` returns the real ECPublicKey). No need for a real self-signed cert.

### T013 — SignRequestHandler test API surface and stub decisions
- Added `kotlinx-coroutines-android` (implementation) and `kotlinx-coroutines-test` (testImplementation) to build.gradle.kts. Coroutines are needed because YubikeyManager methods are `suspend`.
- Tests use `TestScope` + `runTest` from kotlinx-coroutines-test to control coroutine execution and time advancement (needed for timeout test).
- `SignRequestHandler` constructor takes 4 params: `yubikey: YubikeyManager`, `webSocket: AgentWebSocket`, `listener: SignRequestListener`, `scope: CoroutineScope`. The scope allows injecting `TestScope` for testing.
- `SignRequestListener` is a callback interface with 5 methods: `onShowSignDialog(request, pinRequired)`, `onDismissDialog()`, `onPinError(message, retriesRemaining)`, `onPinBlocked(message)`, `onSignError(message)`. T017/T018 must implement this.
- `YubikeyManager.hasCachedPin(): Boolean` is the method SignRequestHandler uses to decide whether to show PIN input. T014 must implement this.
- `YubikeyManager.sign(data: ByteArray, pin: CharArray?): ByteArray` takes optional PIN. T014 must implement this signature.
- PIN error exceptions are in `com.agentrunner.bridge` package: `WrongPinException(retriesRemaining: Int)` and `PinBlockedException(message: String)`. T014 should throw these from YubikeyManager.
- `SshPublicKey` data class is in `com.agentrunner.yubikey` with proper `equals`/`hashCode` overrides for `ByteArray` field.
- Stub source files were created for all types the tests reference. These are minimal stubs with `TODO()` — T014/T016/T017 will replace the implementations.
- `AgentWebSocket` is mocked with `relaxed = true` in tests — T016 implementation just needs matching method signatures.

### T015 — SshKeyFormatter implementation
- `BigInteger.toByteArray()` may return 33 bytes for a 32-byte coordinate (leading 0x00 sign byte) or fewer bytes if the value has leading zeros. `bigIntToFixedBytes` handles both cases — strips leading bytes or zero-pads.
- SSH wire format uses big-endian uint32 length-prefixed strings throughout. `ByteArrayOutputStream` with extension functions keeps the encoding clean.
- The object keeps the static-style API surface (`SshKeyFormatter.toSshPublicKeyBlob(cert)`) matching how YubikeyManager already calls it.

### T016 — AgentWebSocket implementation
- OkHttp WebSocket with `readTimeout(0)` is required — default timeout would close long-lived connections.
- Server message format: `{"type":"ssh-agent-request","requestId":"...","messageType":11|13,"context":"...","data":"base64..."}`. Response: `{"type":"ssh-agent-response","requestId":"...","data":"base64..."}`. Cancel: `{"type":"ssh-agent-cancel","requestId":"..."}`.
- URL scheme conversion: `http://` → `ws://`, `https://` → `wss://`. Path: `/ws/sessions/<sessionId>`.
- Reconnect uses exponential backoff (1s → 30s max). `disconnect()` sets `intentionalDisconnect` flag and interrupts the reconnect thread to prevent zombie reconnections.
- `onSignRequest` callback is invoked on OkHttp's background thread — callers (SignRequestHandler/MainActivity) need to handle thread safety.
- Non-`ssh-agent-request` messages are silently ignored (server sends output, phase, state messages on the same endpoint).

### T017 — SignRequestHandler implementation
- Uses `Channel<CharArray>(Channel.CONFLATED)` for PIN delivery from UI to coroutine. `trySend` from `onPinEntered`, `receive` in `signWithPinLoop`.
- Timeout vs intentional cancellation: `withTimeout` throws `TimeoutCancellationException` (subclass of `CancellationException`). To distinguish from manual `job.cancel()`, an `intentionallyCancelled` flag is set in `onCancel`/`onYubikeyDisconnected` before calling `cancel()`.
- `performSign` passes the base64-decoded data directly to `YubikeyManager.sign()` — the server sends the raw data-to-sign in the `data` field, not the full SSH agent message envelope.
- Response format: SSH_AGENT_SIGN_RESPONSE (type 14) = byte 14 + SSH string signature_blob, where signature_blob = SSH string "ecdsa-sha2-nistp256" + SSH string DER_signature.
- List keys response is built manually (byte 12 + uint32 nkeys + keys) rather than using SshKeyFormatter.buildIdentitiesAnswer — this allows handling multiple keys and matches the test expectations.
- `finishCurrent()` calls `processNext()` which chains to the next queued request. This is how the FIFO queue is drained.

### T014 — YubikeyManager implementation
- Constructor now takes `(context: Context)` — T019 (MainActivity wiring) must pass `applicationContext` or activity context.
- `YubikeyStatus` enum is in its own file `YubikeyStatus.kt` (not inline in YubikeyManager).
- `SshKeyFormatter` stub was created as an `object` (not class) with `toSshPublicKeyBlob` and `buildIdentitiesAnswer` — T015 must keep these as static-style methods on the object.
- PIN caching: `cachedPin` is a `CharArray?` copied on first successful verification. `clearPin()` zeros and nulls it. Never persisted.
- `handlePinError` parses `ApduException.sw`: `0x63CX` → `WrongPinException(retries=X)`, `0x6983` → `PinBlockedException`. On PIN blocked, cached PIN is also cleared.
- `sign()` always opens a fresh `SmartCardConnection` per call (research notes: PIN policy ONCE means per-connection, so PIN must be verified each connection).
- `listKeys()` returns `emptyList()` (not throws) when slot 9a has no certificate — callers should handle empty result gracefully.
- USB device reference is stored and used for `openConnection`. NFC device is stored similarly but is transient (tap-based).
- `stopDiscovery` nulls `nfcDevice` but not `usbDevice` — USB device is nulled via its `onClosed` callback.

### T019 — MainActivity sign flow wiring
- `onSessionChanged` is called BEFORE `currentSessionId` is updated — this allows it to disconnect the old session and connect the new one in sequence.
- `runOnUiThread` wraps `handler.onSignRequest` in the WebSocket callback because OkHttp invokes callbacks on a background thread (see T016 learnings) and SignRequestHandler/UI must run on the main thread.
- `activityScope` uses `SupervisorJob` so a failure in one sign request coroutine doesn't cancel the whole scope.
- `yubikeyManager` init is guarded by `::yubikeyManager.isInitialized` in lifecycle methods because `onCreate` returns early (before init) when `serverUrl` is null.
- `SignRequestDialog.Callback` and `SignRequestListener` are both implemented by MainActivity, which acts as the mediator between the dialog UI and the handler logic.

### T020 — Yubikey status overlay
- Status overlay is added to the same FrameLayout container as WebView and error view. It floats at bottom-end with `layout_gravity`.
- `yubikeyManager.status` LiveData is observed with the Activity as lifecycle owner — auto-unsubscribes on destroy.
- NFC tap uses a simple alpha pulse animation (ObjectAnimator) to draw attention. USB connection is static (persistent connection doesn't need animation).
- Serial number display is not implemented — YubikeyManager doesn't expose serial from its LiveData (would require opening a SmartCardConnection). The `yubikey_connected_serial` string resource exists for future use if serial is added.
- Two drawable backgrounds: dark semi-transparent for disconnected, green semi-transparent for connected. Both use 16dp corner radius for pill shape.

### T021 — JavaScript bridge Yubikey status methods
- `getYubikeyStatus()` reads `yubikeyManager.status.value` synchronously — LiveData's `.value` returns the last posted value on any thread, safe from `@JavascriptInterface` (which runs on WebView background thread).
- `getYubikeySerial()` returns empty string — retrieving serial requires opening a SmartCardConnection (async/blocking I/O), which can't be done synchronously in a `@JavascriptInterface` method. The native overlay shows status; serial can be added later if the PWA needs it.
- Return values match the contract in `contracts/javascript-bridge.md` exactly: `"disconnected"`, `"connected_usb"`, `"connected_nfc"`, `"error"`, and `""` for serial.

### T018 — SignRequestDialog design decisions
- `SignRequestDialog.Callback` interface has two methods: `onPinSubmitted(pin: CharArray)` and `onSignCancelled()`. The host (MainActivity in T019) implements this and delegates to `SignRequestHandler.onPinEntered()` / `onCancel()`.
- `configure(callback, yubikeyStatus)` must be called before `show()` — these references don't survive rotation (unlike Bundle arguments). T026 (rotation handling) will need to re-configure.
- PIN input uses `numberPassword` inputType (numeric, masked). Submitted via IME_ACTION_DONE on the keyboard. PIN char array is created from the text and the EditText is cleared immediately.
- Public methods `showPinError`, `showPinBlocked`, `showSignError` are called by the SignRequestListener implementation to update UI. They guard with `isAdded` to avoid crashes if the fragment is detached.
- `isCancelable = false` + `setCanceledOnTouchOutside(false)` ensures back press and outside touch don't dismiss — user must use the Cancel button.

### T022/T023 — Already implemented
- T022 (app lifecycle for server config) was fully implemented in T007 (onCreate checks ServerConfig.load, redirects to ServerConfigActivity if null).
- T023 (settings navigation) was fully implemented in T011 (`window.AgentRunner.openSettings()` JavaScript bridge) and T006 (ServerConfigActivity pre-populates saved URL).

### T024 — Push notification infrastructure
- Web-push requires a push service endpoint (normally provided by the browser's Push API or FCM on Android). Without Firebase setup (google-services.json), FCM can't provide an endpoint.
- `PushNotificationManager.subscribe()` takes a `pushEndpoint` parameter — the caller must provide a valid endpoint (e.g., from FCM registration). This decouples the subscription logic from the endpoint provider.
- ECDH P-256 key generation uses Android's standard `KeyPairGenerator("EC")` with `secp256r1` — same curve as web-push requires.
- Notification channel `agent_runner_notifications` is created in init{} — safe to call multiple times (Android no-ops duplicate channel creation).
- `POST_NOTIFICATIONS` permission added to manifest — required on Android 13+ (API 33). On lower APIs, notification permission is granted at install time.
- `launchMode="singleTop"` added to MainActivity so notification taps call `onNewIntent()` instead of creating a new activity instance. Combined with `FLAG_ACTIVITY_SINGLE_TOP` on the PendingIntent.
- Deep link navigation from notifications uses `EXTRA_NAVIGATE_HASH` intent extra. The hash is appended to the server URL and loaded in WebView. The extra is cleared after navigation to prevent re-navigation on rotation.
- SharedPreferences name for push: `"agent_runner_push"` (separate from server config's `"agent_runner_prefs"`).

### T025 — Notification tap deep link navigation
- Cold start (app killed) vs warm start (activity in background) require different handling: `onCreate` must defer the hash until after WebView creation; `onNewIntent` can navigate immediately since WebView already exists.
- T024 had already implemented most of T025's requirements (`showNotification` with PendingIntent, `handleNotificationIntent`, `onNewIntent`), but had a bug: `handleNotificationIntent` was called in `onCreate` before WebView was initialized, so cold-start deep links silently failed.
- Fix: store the hash in `pendingNavigateHash` field during `onCreate`, then use it when loading the initial URL.

### T026 — Activity recreation handling
- `configChanges` in manifest already handles rotation without activity recreation, so `onSaveInstanceState`/restore mainly covers low-memory kills and other config changes.
- `serverUrl` is saved to instance state and restored before SharedPreferences fallback — this avoids a race where the user entered a URL via intent extra but hasn't persisted it yet.
- `connectWebSocket` was extracted from `onSessionChanged` to allow reuse during restore (no "old session" to disconnect during fresh recreation).
- `reconfigureSignDialog` looks up the dialog by fragment tag after restoration — the DialogFragment's `arguments` Bundle survives but `callback`/`yubikeyStatus` references (set via `configure()`) are lost in `onDestroyView`. Must call `configure()` again before the fragment's `onViewCreated` re-observes the LiveData.
- `activityScope` is recreated with the new activity instance, so the restored `SignRequestHandler` gets a fresh scope. Any in-flight sign operations from the previous activity instance are lost (acceptable — server would have timed out anyway).

### T027 — Yubikey disconnect mid-signing
- Two disconnect paths: (1) USB `onClosed` fires → status LiveData → MainActivity observer → `signRequestHandler.onYubikeyDisconnected()`, and (2) IOException thrown from `device.openConnection`/SmartCard operations during `sign()` or `listKeys()` → caught in `processSign`'s coroutine.
- NFC has no `onClosed` callback like USB. NFC field loss manifests as IOException during SmartCard operations. YubikeyManager now catches IOException and resets `nfcDevice = null` + posts DISCONNECTED status, ensuring the status overlay updates.
- `onSignError` is called before `onDismissDialog` in the disconnect handler — this briefly shows the error before the dialog dismisses. Matches the pattern used for PIN blocked errors.
- The IOException catch in `signWithPinLoop` re-throws to let the outer `processSign` handler deal with it (send cancel, show error, dismiss, finish).

### T028 — Multiple queued sign requests
- Queue badge uses `processedCount` and `totalReceived` counters rather than tracking position per-request. Position is always 1 (current request), total is `totalReceived - processedCount`. Counters reset when queue drains.
- `cancelAll()` cancels current job + sends cancel for all queued requests. Called from `AgentWebSocket.onDisconnect` callback (invoked on OkHttp background thread, so wrapped in `runOnUiThread` in MainActivity).
- `AgentWebSocket.onDisconnect` fires on `onClosed` and `onFailure` but NOT on intentional disconnect (when `disconnect()` is called). This prevents double-cancel when navigating away from a session.
- `cancelAll()` sends `webSocket.sendCancel()` on the dead socket — OkHttp silently returns false, no crash. No need to add a "skip sends" path.
- `SignRequestListener.onQueueUpdated(position, total)` was added to update the badge on an already-visible dialog when new requests arrive. `onShowSignDialog` also received `queuePosition` and `queueTotal` params with default values of 1 to maintain backward compatibility.
- The `queueBadge` TextView is placed between the title and context text in the dialog layout, hidden by default (gone), shown only when total > 1.

### T029 — WebSocket disconnect during sign modal
- Most of the behavior was already implemented: `cancelAll()` (from T028) dismisses the dialog, cancels current job, and clears the queue. The only missing piece was a user-visible Toast notification.
- Reconnect safety: `cancelAll()` resets all handler state (queue, counters, current request), so when `scheduleReconnect()` fires and reconnects, the handler is clean. The server has already timed out old requests, so no replay occurs.
- `cancelAll()` attempts `sendCancel()` on the dead socket — OkHttp `WebSocket.send()` returns false silently, no exception. Acceptable behavior, no special "dead socket" path needed.

### T030 — ProGuard/R8 rules
- `-keep class com.yubico.yubikit.** { *; }` keeps the entire Yubico SDK — needed because YubiKit uses reflection for USB/NFC transport and SmartCard connections.
- `@JavascriptInterface` methods need a generic `-keepclassmembers` rule (not class-specific) so any future bridge classes are also covered.
- OkHttp `-dontwarn` rules suppress warnings for optional TLS provider classes (Conscrypt, BouncyCastle, OpenJSSE) that may not be on the classpath.
- No Gradle wrapper in the project means ProGuard rules can't be validated via CLI build. Rules are standard and well-documented — low risk.
- This was the final task — a REVIEW phase was appended to tasks.md per the implementation agent protocol.

