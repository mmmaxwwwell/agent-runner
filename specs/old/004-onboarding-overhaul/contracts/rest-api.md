# REST API Contract: Onboarding Overhaul

## Modified Endpoints

### POST /api/projects/onboard

Unified onboarding endpoint — handles both discovered directories and new projects. Replaces the separate `POST /api/workflows/new-project` endpoint.

**Request:**
```json
{
  "name": "my-project",
  "path": "/home/user/git/my-project",
  "newProject": false,
  "remoteUrl": "git@github.com:user/my-project.git",
  "createGithubRepo": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Project name. Derived from path basename or required if `newProject: true`. |
| `path` | string | Conditional | Required for discovered dirs. Ignored if `newProject: true` (derived from projectsDir + name). |
| `newProject` | boolean | No | If true, create directory under projectsDir. Default false. |
| `remoteUrl` | string | No | Git remote URL to configure as origin. |
| `createGithubRepo` | boolean | No | If true, create a GitHub repo via `gh repo create` and set as origin. Mutually exclusive with `remoteUrl`. |

**Validation:**
- If `newProject: true`, `name` is required and must match `/^[a-zA-Z0-9._-]+$/`
- If `newProject: false`, `path` is required and must be an existing directory
- `remoteUrl` and `createGithubRepo` are mutually exclusive
- If project name/path already registered, return 409

**Response (201):**
```json
{
  "projectId": "uuid",
  "sessionId": "uuid",
  "name": "my-project",
  "path": "/home/user/git/my-project",
  "status": "onboarding"
}
```

**Error Responses:**
- 400: Invalid input (missing fields, bad name, mutually exclusive options)
- 409: Project already registered or directory already exists (for new projects)
- 503: Sandbox unavailable and unsandboxed not allowed

**Behavior:**
1. Register project with status `"onboarding"`
2. Run initialization steps (idempotent, sandboxed):
   - Create directory (if `newProject`)
   - Generate flake.nix (if missing)
   - git init (if missing)
   - Configure remote (if provided)
   - Install specify (if missing)
   - specify init (if missing)
3. Launch interview session
4. Return immediately with projectId and sessionId
5. Broadcast onboarding step progress via WebSocket

### DELETE: POST /api/workflows/new-project

Removed. Use `POST /api/projects/onboard` with `newProject: true`.

### GET /api/projects

No structural change. `registered` items may now include `description: string | null`.

## WebSocket Messages

### Onboarding Step Progress

Sent on `/ws/dashboard` during onboarding initialization:

```json
{
  "type": "onboarding-step",
  "projectId": "uuid",
  "step": "generate-flake",
  "status": "completed",
  "error": null
}
```

| Field | Type | Values |
|-------|------|--------|
| `step` | string | `register`, `create-directory`, `generate-flake`, `git-init`, `git-remote`, `install-specify`, `specify-init`, `launch-interview` |
| `status` | string | `running`, `completed`, `skipped`, `error` |
| `error` | string\|null | Error message if status is `error` |
