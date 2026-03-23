# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T016/T017 — Sequence diagrams were already in UI_FLOW.md
The T014/T015 implementation added not only the screen-by-screen detail sections but also all 4 API sequence diagrams (new project workflow, add feature workflow, session lifecycle, push notification subscription) at lines 400-604. T016 was redundant. Future task generation should check whether prior tasks' scope already covered later tasks' content.

### T017 — Pre-existing test failures (2 of 331)
Two tests fail before any changes in this feature: `websocket-api.test.ts` (sync message format) and `session-stop.test.ts` (stop running session + kill process). These are pre-existing and unrelated to the UI flow documentation work. Phase 7 (T023) should address these.

