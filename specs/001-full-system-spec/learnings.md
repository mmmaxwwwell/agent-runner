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

### T004 — Test keypair generator
- `tsx` is not on PATH in the nix shell; use `npx tsx` instead.
- `import.meta.dirname` works in Node 22 with tsx — gives the directory of the current module file.
- SSH authorized_keys format for ECDSA P-256: `ecdsa-sha2-nistp256 <base64(string("ecdsa-sha2-nistp256") + string("nistp256") + string(0x04||x||y))> comment`
- Generated test keys are gitignored — each machine generates its own. The `ensureTestKeypair()` function is idempotent.

### T005 — Test SSH server
- `ssh2` library does NOT export named ESM exports. Must use `import ssh2 from 'ssh2'` then destructure `const { Server } = ssh2`.
- `ssh2` cannot parse PKCS8 PEM keys (the format Node.js `generateKeyPairSync` uses by default for EC keys). EC private keys must be in SEC1 format (`"BEGIN EC PRIVATE KEY"`). Use `createPrivateKey(pkcs8Pem).export({ type: 'sec1', format: 'pem' })` to convert.
- For SSH server host keys, `ssh2` needs RSA (PKCS1) or similar — ed25519 PKCS8 format is rejected.
- OpenSSH 10.0 has algorithm negotiation issues with `ssh2`'s server. Integration tests should use the `ssh2` Client library rather than shelling out to `ssh`/`git clone`. The `info.clientPrivateKey` field provides the SEC1-formatted key for ssh2 Client use.
- The test SSH server creates a temp bare git repo with an initial commit and cleans it up on `stop()`. The repo path changes each run (uses `mkdtempSync`).

### T008 — Server smoke test
- Server starts cleanly with `nix develop -c npm run dev` — no startup crashes.
- Data dir defaults to `~/.local/share/agent-runner/`. Auto-creates `projects.json` and `push-subscriptions.json` if missing.
- VAPID keys auto-generated and saved to `vapid-keys.json` in data dir on first run.
- `ensureAgentFramework()` runs on startup (git clone/pull of agent-framework repo into data dir) — can be slow on first run.
- `GET /api/projects` returns `{ registered: [], discovered: [...] }` — discovered array scans `~/git` by default (env `AGENT_RUNNER_PROJECTS_DIR`).
- WebSocket upgrade for `/ws/dashboard` works correctly.
- PWA assets (app.js, sw.js, manifest.json, index.html) all served from `public/` directory.
- No code changes were needed — everything worked out of the box after T007's build fix.

### T009 — API endpoint verification
- `GET /api/health` returns `{ status, uptime, sandboxAvailable, cloudSttAvailable }` — matches contract exactly.
- `GET /api/projects` returns `{ registered, discovered, discoveryError }` — structure matches contract.
- Discovered items include extra `type: "discovered"` field not in the contract, and `hasSpecKit` is an object `{ spec, plan, tasks }` instead of a boolean. These are enhancements over the contract — contract tests in Phase 5 will validate compatibility.
- No code changes needed — both endpoints work correctly out of the box.

### T010 — Unit tests all green
- All 367 unit tests (18 test files) passed on first run with zero failures and zero code changes needed.
- The codebase was already in good shape from Phases 1–2 work. Phase 3 checkpoint met immediately.
