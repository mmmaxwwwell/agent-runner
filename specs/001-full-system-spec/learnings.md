# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T001 — Custom test reporter
- Node.js 22 test runner custom reporter API: export default async generator function that yields strings. Events arrive via async iterable.
- `details.type === 'suite'` distinguishes `describe()` blocks from `it()`/`test()` leaf tests — must filter suites to get accurate pass/fail counts.
- `details.error.expected` and `details.error.actual` are often undefined for assertion errors; the comparison info is embedded in `error.message` instead.
- The `test:diagnostic` event's data can be a string directly or have a `.message` property — handle both.
- Reporter path is relative to cwd: `--test-reporter=./tests/helpers/test-reporter.ts`
- `TEST_TYPE` env var controls the output subdirectory (unit/integration/contract).

