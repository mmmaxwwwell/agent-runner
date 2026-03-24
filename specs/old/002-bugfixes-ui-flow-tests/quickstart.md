# Quickstart: Bugfixes, UI Flow Documentation, and Integration Tests

## Prerequisites

- Nix flake environment (already set up for agent-runner)
- Node.js 22 (provided by flake)

## Development

```bash
# Enter the dev environment
nix develop

# Run the dev server
nix develop -c npm run dev

# Run all tests
nix develop -c npm test

# Build
nix develop -c npm run build
```

## What This Feature Changes

### Bug Fix 1: Start Project Endpoint
- **File**: `src/routes/projects.ts`
- **Change**: Add `POST /api/workflows/new-project` route handler
- **Test**: `tests/integration/new-project-workflow.test.ts`
- **Verify**: Navigate to `#/new`, fill in name + description, click "Start Project" — should no longer return 404

### Bug Fix 2: Microphone Continuous Listening
- **File**: `src/client/lib/voice.ts`
- **Change**: Set `continuous: true`, `interimResults: true`, add silence timeout, accumulate results
- **Test**: Manual browser test — click mic, speak for 10+ seconds, verify full transcription
- **Verify**: Mic captures multi-sentence dictation without premature cutoff

### Documentation: UI Flow
- **File**: `UI_FLOW.md` (project root)
- **Verify**: Render Mermaid diagrams, check all 6 screens and 16+ endpoints are covered

### Integration Tests
- **Files**: 5 new test files in `tests/integration/`
- **Run**: `nix develop -c npm test`
- **Verify**: All tests pass, each references its `UI_FLOW.md` section
