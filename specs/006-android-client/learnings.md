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

