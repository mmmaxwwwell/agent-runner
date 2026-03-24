# Quickstart: Project Directory Discovery & Onboarding

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

### Backend: Directory Discovery Service
- **New file**: `src/services/discovery.ts`
- **Change**: Scans `projectsDir` for top-level non-hidden directories, detects git repos and spec-kit artifacts
- **Test**: `tests/unit/discovery.test.ts`

### Backend: Extended Projects API
- **File**: `src/routes/projects.ts`
- **Change**: `GET /api/projects` now returns `{ registered, discovered, discoveryError }` instead of a flat array
- **Test**: `tests/integration/discovery-api.test.ts`
- **Verify**: `curl http://localhost:3000/api/projects | jq` — should show both registered and discovered sections

### Backend: Onboard Endpoint
- **File**: `src/routes/projects.ts`
- **Change**: New `POST /api/projects/onboard` endpoint for one-click onboarding
- **Test**: `tests/integration/onboard-api.test.ts`
- **Verify**: `curl -X POST http://localhost:3000/api/projects/onboard -d '{"name":"my-repo","path":"/home/user/git/my-repo"}'`

### Backend: Project Model Updates
- **File**: `src/models/project.ts`
- **Change**: Added `status` field, `registerForOnboarding()`, `updateProjectStatus()`
- **Test**: `tests/unit/project.test.ts` (extended)

### Frontend: Dashboard Discovery UI
- **File**: `src/client/components/dashboard.tsx`
- **Change**: Two-section layout showing registered projects and discovered directories with "Onboard" button
- **Verify**: Open dashboard — directories in `~/git` that aren't registered should appear in "Discovered" section
