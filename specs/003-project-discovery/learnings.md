# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T001 — Status field backward compatibility
The `readProjects()` function uses `Omit<Project, 'status'> & { status?: ProjectStatus }` to type the raw JSON, then maps with `p.status ?? 'active'`. This means existing `projects.json` files work without migration. Future tasks adding new functions (`registerForOnboarding`, etc.) should follow this same pattern if they add optional fields.

---

### T009 — Integration test for discovery API uses two server instances
The `discoveryError` test case (missing projectsDir) needs its own server instance with a different `AGENT_RUNNER_PROJECTS_DIR` pointing to a non-existent path. This is handled as a separate `describe` block with its own `before`/`after` lifecycle that starts/stops a second server on a different port. Follow this pattern when testing different server configurations.

---

### T006 — Running individual test files
`tsx` is not on PATH in nix develop; use `nix develop -c npx tsx --test --test-reporter=spec tests/unit/project.test.ts` to run a single test file. The `npm test` command runs all test files and `--test-name-pattern` is too broad for isolating a single file.

---

### T013 — GET /api/projects response shape change breaks existing tests
Changing the response from a flat array to `{ registered, discovered, discoveryError }` requires updating all test files that call `GET /api/projects` and assert on the body shape. Three test files needed updates: `tests/contract/rest-api-projects.test.ts`, `tests/contract/rest-api.test.ts`, and `tests/integration/dashboard-api.test.ts`. The client dashboard (`src/client/components/dashboard.tsx`) also consumes this endpoint and will need updating in T014/T015 — the client is knowingly broken until then.

---

