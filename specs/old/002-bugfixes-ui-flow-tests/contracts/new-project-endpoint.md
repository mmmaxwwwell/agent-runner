# Contract: POST /api/workflows/new-project

New endpoint added by this feature to fix the "not found" error when clicking "Start Project".

## Endpoint

`POST /api/workflows/new-project`

## Request

```json
{
  "name": "my-new-project",
  "description": "A project that does X and Y",
  "allowUnsandboxed": false
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | string | Yes | Non-empty after trim, matches `/^[a-zA-Z0-9._-]+$/`, not already registered or existing as directory |
| `description` | string | Yes | Non-empty after trim |
| `allowUnsandboxed` | boolean | No | Default `false`. Requires server `ALLOW_UNSANDBOXED=true` to take effect |

## Response

### 201 Created

```json
{
  "sessionId": "uuid",
  "projectId": "uuid",
  "phase": "specify",
  "state": "running"
}
```

The workflow runs asynchronously after the response. The client should connect to `ws://host:port/ws/sessions/{sessionId}` to stream output from the first phase.

### 400 Bad Request

```json
{ "error": "Missing or empty name" }
{ "error": "Invalid project name: must contain only letters, numbers, dots, hyphens, underscores" }
{ "error": "Missing or empty description" }
{ "error": "allowUnsandboxed requested but server ALLOW_UNSANDBOXED env var not set" }
```

### 409 Conflict

```json
{ "error": "A project with name 'my-project' already exists" }
```

Returned when either:
- A project with the same name is already registered in `projects.json`
- A directory `AGENT_RUNNER_PROJECTS_DIR/<name>` already exists

### 503 Service Unavailable

```json
{ "error": "Sandbox unavailable and unsandboxed execution not allowed" }
```

## Behavior

1. Validate `name` and `description`
2. Check for duplicate project name (registry + filesystem)
3. Check sandbox availability
4. Create project directory at `AGENT_RUNNER_PROJECTS_DIR/<name>/`
5. Create first session (type: `interview`, for specify phase)
6. Return response immediately
7. Asynchronously run `startNewProjectWorkflow()` which executes: specify → clarify → plan → tasks → analyze
8. On completion, auto-register project and launch task-run
9. Broadcast phase transitions via WebSocket dashboard and session stream

## Relationship to Existing Endpoints

This endpoint mirrors the pattern of `POST /api/projects/:id/add-feature` but:
- Creates a new project directory instead of operating on an existing one
- Uses `startNewProjectWorkflow()` instead of `startAddFeatureWorkflow()`
- Calls `deps.registerProject()` on completion (add-feature skips this)
- Accepts `name` instead of `projectId` (the project doesn't exist yet)
