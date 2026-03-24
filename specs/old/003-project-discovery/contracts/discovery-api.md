# API Contract: Discovery & Onboarding Endpoints

## GET /api/projects (modified)

### Response (200)

```json
{
  "registered": [
    {
      "type": "registered",
      "id": "uuid-1234",
      "name": "agent-runner",
      "dir": "/home/user/git/agent-runner",
      "taskFile": "tasks.md",
      "promptFile": "prompt.md",
      "createdAt": "2026-03-22T10:00:00.000Z",
      "status": "active",
      "taskSummary": {
        "total": 20,
        "completed": 15,
        "blocked": 1,
        "skipped": 0,
        "remaining": 4
      },
      "activeSession": null,
      "dirMissing": false
    }
  ],
  "discovered": [
    {
      "type": "discovered",
      "name": "my-other-repo",
      "path": "/home/user/git/my-other-repo",
      "isGitRepo": true,
      "hasSpecKit": {
        "spec": true,
        "plan": false,
        "tasks": false
      }
    }
  ],
  "discoveryError": null
}
```

### Response when projectsDir is missing

```json
{
  "registered": [],
  "discovered": [],
  "discoveryError": "Projects directory does not exist: /home/user/nonexistent"
}
```

---

## POST /api/projects/onboard

### Request

```json
{
  "name": "my-other-repo",
  "path": "/home/user/git/my-other-repo"
}
```

### Response (201)

```json
{
  "projectId": "uuid-5678",
  "name": "my-other-repo",
  "path": "/home/user/git/my-other-repo",
  "status": "onboarding"
}
```

### Error: missing path (400)

```json
{
  "error": "Missing or invalid \"path\" field"
}
```

### Error: path is not a directory (400)

```json
{
  "error": "Path is not a directory: /home/user/git/some-file.txt"
}
```

### Error: already registered (409)

```json
{
  "error": "A project with this directory is already registered: /home/user/git/my-other-repo"
}
```
