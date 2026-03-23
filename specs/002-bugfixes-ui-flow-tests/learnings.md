# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T016/T017 — Sequence diagrams were already in UI_FLOW.md
The T014/T015 implementation added not only the screen-by-screen detail sections but also all 4 API sequence diagrams (new project workflow, add feature workflow, session lifecycle, push notification subscription) at lines 400-604. T016 was redundant. Future task generation should check whether prior tasks' scope already covered later tasks' content.

### T017 — Pre-existing test failures (2 of 331)
Two tests fail before any changes in this feature: `websocket-api.test.ts` (sync message format) and `session-stop.test.ts` (stop running session + kill process). These are pre-existing and unrelated to the UI flow documentation work. Phase 7 (T023) should address these.

### T018 — Integration test server setup requires LOG_LEVEL: 'info'
The server startup detection relies on matching "Agent Runner server started" in stderr (pino output). Using `LOG_LEVEL: 'warn'` suppresses this info-level message, causing the server start detection to time out. All integration/contract tests MUST use `LOG_LEVEL: 'info'` or lower.

### T019 — Voice endpoint returns 400 before 503
The `POST /api/voice/transcribe` handler checks for audio data presence BEFORE checking for the Google STT API key. This means a request with no audio always gets 400 regardless of API key config. Tests for 503 must include valid audio in the request body. Non-multipart content types are treated as "no audio" — only `multipart/form-data` with an `audio` field is accepted.

### T020 — preCreateSession pattern for testing session states
The `rest-api.test.ts` contract test establishes a `preCreateSession()` helper that writes `meta.json` directly to the data directory, bypassing process spawning. This is essential for testing session endpoints in specific states (waiting-for-input, completed, failed) without relying on process timing. Adopted the same pattern for session-lifecycle tests. Remember to clean up pre-created active sessions (set state to failed) between tests to avoid 409 conflicts in later tests.

### T020 — Pre-existing test failure count is 4, not 2
Updated from T017: there are actually 4 pre-existing test failures (388 total tests): `websocket-api.test.ts` (sync message format), `session-stop.test.ts` (2 tests: stop + kill process), and `websocket.test.ts` (reconnect replay). All are unrelated to session-lifecycle work.

