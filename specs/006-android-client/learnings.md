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

