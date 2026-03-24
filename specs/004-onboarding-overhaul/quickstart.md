# Quickstart: Onboarding Overhaul

## Verify Development Environment

```bash
# Enter nix dev shell
nix develop -c bash

# Check Node.js
node --version  # Should be v22.x

# Run existing tests
npm test

# Build
npm run build
```

## Key Files to Understand

Before implementing, read these in order:

1. `src/services/sandbox.ts` — Current sandbox command builder (being enhanced)
2. `src/services/spec-kit.ts` — Current SDD workflow orchestrator (being restructured)
3. `src/services/flake-generator.ts` — Current flake generation (adding arch detection)
4. `src/lib/config.ts` — Config loader (changing default dataDir)
5. `src/routes/projects.ts` — Project routes (unifying onboard + new-project)
6. `src/models/project.ts` — Project model (adding description field)
7. `src/ws/session-stream.ts` — WebSocket output streaming (reference for transcript parser polling pattern)

## Testing Commands

```bash
# Run all tests
nix develop -c npm test

# Run specific test file
nix develop -c npx tsx --test tests/unit/sandbox.test.ts

# Build and verify
nix develop -c npm run build

# Lint
nix develop -c npm run lint
```

## Sandbox Testing (Manual)

```bash
# Test nix shell composition inside sandbox
systemd-run --user --pipe \
  --property=ProtectHome=tmpfs \
  "--property=BindPaths=/tmp/test-project $HOME/.cache/nix $HOME/.local/share/uv" \
  --property=ProtectSystem=strict \
  -- nix shell 'github:NixOS/nixpkgs/nixpkgs-unstable#claude-code' \
              'github:NixOS/nixpkgs/nixpkgs-unstable#uv' \
    --command nix develop /tmp/test-project --command claude --version

# Test agent-framework read-only bind
systemd-run --user --pipe \
  --property=ProtectHome=tmpfs \
  "--property=BindPaths=/tmp/test-project $HOME/.cache/nix" \
  "--property=BindReadOnlyPaths=$HOME/.local/share/agent-runner/agent-framework" \
  --property=ProtectSystem=strict \
  -- cat $HOME/.local/share/agent-runner/agent-framework/ROUTER.md
```

## Architecture Detection

```bash
# Check what Node.js reports
node -e "console.log(process.arch, process.platform)"
# Expected: x64 linux → maps to x86_64-linux
# On ARM:   arm64 linux → maps to aarch64-linux
```
