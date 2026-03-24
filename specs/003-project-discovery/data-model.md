# Data Model: Project Directory Discovery & Onboarding

## Modified Entities

### Project (modified)

**File**: `src/models/project.ts`

```typescript
export interface Project {
  id: string;                                    // UUID (unchanged)
  name: string;                                  // 1-100 chars (unchanged)
  dir: string;                                   // Absolute path (unchanged)
  taskFile: string;                              // Default "tasks.md" (unchanged)
  promptFile: string;                            // Auto-detected (unchanged)
  createdAt: string;                             // ISO 8601 (unchanged)
  status: "active" | "onboarding" | "error";     // NEW — default "active" for existing projects
}
```

**Migration**: Existing `projects.json` entries lack `status`. On read, treat missing `status` as `"active"`. No file migration needed — the reader handles the default.

**Storage**: `~/.agent-runner/projects.json` (unchanged)

### New Functions in `src/models/project.ts`

```typescript
// Register a project for onboarding — relaxed validation (no tasks.md requirement)
export function registerForOnboarding(dataDir: string, input: { name: string; dir: string }): Project;

// Update project status
export function updateProjectStatus(dataDir: string, id: string, status: Project['status']): Project;
```

## New Types

### DiscoveredDirectory

Not persisted. Computed at request time from filesystem scan.

```typescript
export interface DiscoveredDirectory {
  type: "discovered";
  name: string;           // Directory basename
  path: string;           // Absolute path
  isGitRepo: boolean;
  hasSpecKit: {
    spec: boolean;
    plan: boolean;
    tasks: boolean;
  };
}
```

**Location**: `src/models/project.ts` (co-located with Project type)

## New API Shapes

### GET /api/projects (modified response)

**Before**:
```typescript
Array<Project & { taskSummary: TaskSummary; activeSession: ActiveSession | null }>
```

**After**:
```typescript
{
  registered: Array<{
    type: "registered";
    id: string;
    name: string;
    dir: string;
    taskFile: string;
    promptFile: string;
    createdAt: string;
    status: "active" | "onboarding" | "error";
    taskSummary: TaskSummary;
    activeSession: ActiveSession | null;
    dirMissing: boolean;
  }>;
  discovered: Array<DiscoveredDirectory>;
  discoveryError: string | null;
}
```

### POST /api/projects/onboard (new)

**Request**:
```typescript
{
  name: string;       // Project display name (defaults to directory basename)
  path: string;       // Absolute path to directory
}
```

**Validation**:
- `path`: must exist, must be a directory, must not already be registered
- `name`: non-empty, ≤100 chars, trimmed

**Success response** (201):
```typescript
{
  projectId: string;     // UUID of newly registered project
  name: string;
  path: string;
  status: "onboarding";
}
```

**Error responses**:
- 400: validation error (missing fields, path not a directory)
- 409: directory already registered

## State Transitions

### Project Status

```
(new onboarding) → "onboarding"
"onboarding" → "active"      (workflow completes successfully)
"onboarding" → "error"       (workflow fails)
"error" → "onboarding"       (user retries)
"active" → "active"          (steady state)
```

## Existing Entities (unchanged)

### Session
No changes. Sessions created during onboarding workflow use the same Session model.

### TaskSummary
No changes. Returns zeros for projects without `tasks.md`.

### Config
No changes. `projectsDir` already exists and defaults to `~/git`.
