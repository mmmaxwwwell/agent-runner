# Learnings

Discoveries, gotchas, and decisions recorded by the implementation agent across runs.
Each entry should include a timestamp and the task ID that produced the learning.

---

### T001 — Status field backward compatibility
The `readProjects()` function uses `Omit<Project, 'status'> & { status?: ProjectStatus }` to type the raw JSON, then maps with `p.status ?? 'active'`. This means existing `projects.json` files work without migration. Future tasks adding new functions (`registerForOnboarding`, etc.) should follow this same pattern if they add optional fields.

---

### T006 — Running individual test files
`tsx` is not on PATH in nix develop; use `nix develop -c npx tsx --test --test-reporter=spec tests/unit/project.test.ts` to run a single test file. The `npm test` command runs all test files and `--test-name-pattern` is too broad for isolating a single file.

---

