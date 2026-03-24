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

