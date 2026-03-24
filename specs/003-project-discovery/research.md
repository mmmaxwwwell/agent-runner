# Research: Project Directory Discovery & Onboarding

## Directory Scanning Approach

### Decision: Use `readdirSync` with `withFileTypes: true` on `cfg.projectsDir` for top-level scanning

**Rationale**: The spec requires scanning only top-level entries (FR-002) in a directory expected to contain <100 entries (Assumptions). `readdirSync` with `withFileTypes: true` provides the entry type without additional `stat` calls, giving us O(1) per entry for the basic listing. Git detection and spec-kit artifact detection require a few `existsSync` calls per discovered directory, but with <100 entries this is negligible.

**Alternatives considered**:
- Async `readdir` — rejected because the operation is fast (sub-millisecond for <100 entries) and the endpoint is called once per page load (FR-013). Async adds complexity for no measurable benefit.
- `fs.watch` or polling — rejected per FR-013: discovered list is computed on page load only.

### Filtering rules

1. Skip entries where `dirent.isDirectory()` is false (unless symlink pointing to directory)
2. Skip names starting with `.` (FR-003)
3. Skip entries whose resolved path matches any registered project's `dir` (FR-011)
4. For symlinks: `existsSync(resolved)` + `statSync(resolved).isDirectory()` — skip broken symlinks silently

---

## API Response Shape

### Decision: Extend `GET /api/projects` to return a unified response with `type` discriminator

**Rationale**: The spec mandates a single endpoint returning both registered and discovered entries (FR-001). Using a `type: "registered" | "discovered"` discriminator allows the client to render them differently while fetching everything in one call.

**Response structure**:
```typescript
{
  registered: Array<{
    type: "registered";
    id: string;
    name: string;
    dir: string;
    taskFile: string;
    createdAt: string;
    taskSummary: TaskSummary;
    activeSession: ActiveSession | null;
  }>;
  discovered: Array<{
    type: "discovered";
    name: string;        // directory basename
    path: string;        // absolute path
    isGitRepo: boolean;  // FR-005
    hasSpecKit: {        // FR-006
      spec: boolean;
      plan: boolean;
      tasks: boolean;
    };
  }>;
}
```

**Alternatives considered**:
- Flat array with mixed types — rejected because the client needs to separate them anyway. Two arrays are clearer and avoid type narrowing on every element.
- Separate endpoint (`GET /api/discovered`) — rejected per spec: FR-001 explicitly requires a single endpoint.

### Breaking change assessment

The current `GET /api/projects` returns a flat `Project[]` array. Changing to `{ registered, discovered }` is a **breaking change** for the client. The client (`dashboard.tsx`) currently expects an array. Both the API and client must be updated together. Since this is a single-user local app with no external API consumers, the breaking change is acceptable.

---

## Project Model Changes

### Decision: Make `taskFile` and `promptFile` optional to support onboarding (FR-010)

**Rationale**: Currently `createProject()` requires `tasks.md` to exist in the directory (line 80 of `project.ts`). The spec requires that onboarding registers a project immediately, before any workflow phases complete (FR-009, FR-010). At onboarding time, the directory may be a bare git repo with no spec-kit artifacts.

**Changes needed**:
1. Add a new `registerProject()` function (or modify `createProject()`) that:
   - Does NOT require `tasks.md`
   - Sets `taskFile` to `"tasks.md"` (the eventual location)
   - Sets `promptFile` to empty string (auto-detected later)
   - Adds `status` field: `"onboarding" | "active" | "error"` (per spec Key Entities)
2. Add `status` field to `Project` interface with default `"active"` for existing projects

**Alternatives considered**:
- Creating a separate `DiscoveredProject` model — rejected because after onboarding, a discovered directory becomes a regular project. One model with a status field is simpler.
- Making `createProject()` accept an options bag to skip validation — rejected because the existing `createProject()` is used by the `POST /api/projects` endpoint which should continue requiring `tasks.md` for explicit registration. A separate function for onboarding is clearer.

---

## Onboarding Flow

### Decision: POST to existing `/api/workflows/new-project` with the discovered directory's path

**Rationale**: The onboarding action (FR-008) needs to:
1. Register the project in `projects.json` immediately (FR-009)
2. Start the new-project workflow

The existing `POST /api/workflows/new-project` endpoint already handles step 2. We need to modify it slightly:
- Accept an optional `dir` field — when provided, use the existing directory instead of creating a new one
- Register the project immediately before starting the workflow (FR-009), not as a callback after completion

**New endpoint**: `POST /api/projects/onboard` — a dedicated endpoint is cleaner because onboarding an existing directory has different semantics than creating a new project:
- No directory creation needed
- Immediate registration required
- Different validation (directory must exist vs. must not exist)

**Flow**:
1. Client calls `POST /api/projects/onboard` with `{ name, path }`
2. Server validates the path exists and is a directory
3. Server registers the project immediately in `projects.json` with `status: "onboarding"`
4. Server starts the new-project workflow asynchronously
5. Server returns `{ projectId, sessionId, phase, state }` (same shape as new-project)
6. Dashboard shows the project immediately as a registered project

**Alternatives considered**:
- Reusing `POST /api/projects` — rejected because that endpoint is for explicit registration of already-complete projects. Onboarding is semantically different (it kicks off a workflow).
- Reusing `POST /api/workflows/new-project` with a flag — rejected because the validation, directory handling, and registration timing are all different. A clean endpoint is simpler than conditional logic.

---

## Git Detection

### Decision: Check for `.git` directory or file (submodule case)

**Implementation**: `existsSync(join(dirPath, '.git'))` — works for both regular repos (`.git/` directory) and submodules (`.git` file pointing to worktree).

No need to run `git` commands. The presence of `.git` is sufficient for the indicator (FR-005).

---

## Spec-Kit Artifact Detection

### Decision: Check for existence of three specific files in the specs/ subdirectory

**Implementation**:
```typescript
function detectSpecKitArtifacts(dirPath: string): { spec: boolean; plan: boolean; tasks: boolean } {
  // Look for spec-kit artifacts in any specs/*/  subdirectory
  const specsDir = join(dirPath, 'specs');
  if (!existsSync(specsDir)) return { spec: false, plan: false, tasks: false };

  // Scan first-level subdirectories for artifacts
  const entries = readdirSync(specsDir, { withFileTypes: true });
  let spec = false, plan = false, tasks = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = join(specsDir, entry.name);
    if (existsSync(join(subDir, 'spec.md'))) spec = true;
    if (existsSync(join(subDir, 'plan.md'))) plan = true;
    if (existsSync(join(subDir, 'tasks.md'))) tasks = true;
    if (spec && plan && tasks) break;
  }
  return { spec, plan, tasks };
}
```

Also check for `tasks.md` in the project root (the current convention for registered projects).

---

## Dashboard UI Changes

### Decision: Two-section layout — registered projects first, then discovered directories

**Rationale**: The spec requires visual distinction (FR-007). Separate sections with different card styles make the distinction immediately obvious (SC-003).

**Registered projects section**: Existing `ProjectCard` component, unchanged.

**Discovered directories section**: New `DiscoveredCard` component with:
- Directory name (basename)
- Git indicator icon/badge
- Spec-kit artifact badges (if any)
- "Onboard" button that calls `POST /api/projects/onboard`

**Empty states**:
- No registered + no discovered: "No projects found in ~/git"
- No registered + some discovered: Show discovered section only with guidance text
- Some registered + no discovered: Show registered section only

---

## Error Handling

### Missing projects directory (FR-012)

If `cfg.projectsDir` doesn't exist or is inaccessible, `GET /api/projects` should:
- Still return registered projects (from `projects.json`)
- Return an empty `discovered` array
- Include a `discoveryError` string field in the response

### Missing registered project directory

If a registered project's `dir` no longer exists on disk:
- The project still appears in the registered list
- `taskSummary` returns zeros (existing `safeParseTaskSummary` already handles this)
- A `dirMissing: true` flag is added to the response

### Permission errors

Skip unreadable directories during scanning (try/catch around `readdirSync` for individual entries).
