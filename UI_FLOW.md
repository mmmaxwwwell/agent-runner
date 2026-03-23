# UI Flow: Agent Runner

Authoritative reference for all screens, routes, API calls, WebSocket connections, state transitions, and field validations in the Agent Runner application.

## Main Flow Diagram

```mermaid
flowchart TD
    %% ===== SCREENS =====
    DASH["#/ Dashboard"]
    NEW["#/new New Project"]
    PROJ["#/projects/:id Project Detail"]
    SESS["#/sessions/:id Session View"]
    FEAT["#/projects/:id/add-feature Add Feature"]
    SETT["#/settings Settings"]

    %% ===== SHARED INLINE COMPONENTS =====
    SKCHAT_NEW["SpecKitChat (inline in New Project)"]
    SKCHAT_FEAT["SpecKitChat (inline in Add Feature)"]

    %% ===== NAVIGATION TRANSITIONS =====
    DASH -- "Click '+ New Project'" --> NEW
    DASH -- "Click project card" --> PROJ
    DASH -- "Click Settings (header)" --> SETT

    NEW -- "POST /api/workflows/new-project → 201" --> SKCHAT_NEW
    SKCHAT_NEW -- "Phase reaches 'implementation' (auto-nav 2s)" --> DASH

    PROJ -- "Click 'View Session'" --> SESS
    PROJ -- "Click 'Add Feature'" --> FEAT
    PROJ -- "Back (header)" --> DASH

    FEAT -- "POST /api/projects/:id/add-feature → 201" --> SKCHAT_FEAT
    SKCHAT_FEAT -- "Phase reaches 'implementation' (auto-nav 2s)" --> PROJ

    SESS -- "Back (header)" --> PROJ
    SETT -- "Back (header)" --> DASH
    NEW -- "Back (header)" --> DASH
    FEAT -- "Back (header)" --> PROJ

    %% ===== ON-LOAD API CALLS =====
    DASH -. "GET /api/projects" .-> DASH
    PROJ -. "GET /api/projects/:id" .-> PROJ
    SESS -. "GET /api/sessions/:id" .-> SESS
    SESS -. "GET /api/sessions/:id/log" .-> SESS
    SETT -. "GET /api/health" .-> SETT

    %% ===== WEBSOCKET CONNECTIONS =====
    DASH == "WS /ws/dashboard\n(project-update messages)" ==> DASH
    SESS == "WS /ws/sessions/:id?lastSeq=N\n(output, state, progress)" ==> SESS
    SKCHAT_NEW == "WS /ws/sessions/:sessionId\n(output, state, phase)" ==> SKCHAT_NEW
    SKCHAT_FEAT == "WS /ws/sessions/:sessionId\n(output, state, phase)" ==> SKCHAT_FEAT

    %% ===== USER ACTIONS (non-navigation) =====
    PROJ -- "Click 'Start Task Run'\nPOST /api/projects/:id/sessions" --> SESS
    PROJ -- "Click 'Stop'\nPOST /api/sessions/:id/stop" --> PROJ
    SESS -- "Submit input\nPOST /api/sessions/:id/input" --> SESS
    SESS -- "Click 'Enable Notifications'\nGET /api/push/vapid-key\nPOST /api/push/subscribe" --> SESS
    SETT -- "Change log level\nPUT /api/config/log-level" --> SETT

    %% ===== ERROR PATHS =====
    NEW -- "POST → 400 (validation)\nor 409 (duplicate)" --> NEW
    FEAT -- "POST → 400 / 404 / 409" --> FEAT
    PROJ -- "Start → 400 / 409 / 503" --> PROJ
    SESS -- "Input → 400 / 404" --> SESS

    %% ===== STYLING =====
    classDef screen fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef inline fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    class DASH,NEW,PROJ,SESS,FEAT,SETT screen
    class SKCHAT_NEW,SKCHAT_FEAT inline
```

### Legend

| Style | Meaning |
|-------|---------|
| Solid arrow (`-->`) | User-triggered navigation or action |
| Dotted arrow (`-.->`) | On-load API call (GET) |
| Double-line arrow (`==>`) | WebSocket connection (persistent) |
| Blue boxes | Top-level screens (hash routes) |
| Orange boxes | Inline components (no route change) |

### Session State Machine

```mermaid
stateDiagram-v2
    [*] --> running: Session created
    running --> waiting_for_input: Agent asks question
    running --> completed: Process exits 0
    running --> failed: Process exits non-0 / stopped
    waiting_for_input --> running: User submits input
    completed --> [*]
    failed --> [*]
```

### Spec-Kit Workflow Phases

```mermaid
stateDiagram-v2
    [*] --> specify: Workflow starts
    specify --> clarify
    clarify --> plan
    plan --> tasks
    tasks --> analyze
    analyze --> analyze: Issues found (max 5 iterations)
    analyze --> implementation: No issues / cap reached
    implementation --> [*]
```

### API Endpoint Summary

| Method | Path | Used By | Purpose |
|--------|------|---------|---------|
| GET | `/api/health` | Settings | Server health, sandbox/STT availability |
| PUT | `/api/config/log-level` | Settings | Update server log level |
| GET | `/api/projects` | Dashboard | List all projects with task summaries |
| POST | `/api/projects` | (admin) | Register existing project directory |
| GET | `/api/projects/:id` | ProjectDetail | Full project info with tasks/sessions |
| DELETE | `/api/projects/:id` | (admin) | Unregister project |
| POST | `/api/projects/:id/sessions` | ProjectDetail | Start task-run or interview session |
| GET | `/api/projects/:id/sessions` | (API) | List sessions for a project |
| POST | `/api/projects/:id/add-feature` | AddFeature | Start add-feature workflow |
| POST | `/api/workflows/new-project` | NewProject | Start new-project workflow |
| GET | `/api/sessions/:id` | SessionView | Fetch session metadata |
| GET | `/api/sessions/:id/log` | SessionView | Fetch session log entries |
| POST | `/api/sessions/:id/stop` | ProjectDetail | Stop a running session |
| POST | `/api/sessions/:id/input` | SessionView | Submit input to waiting session |
| GET | `/api/push/vapid-key` | SessionView | Get VAPID public key |
| POST | `/api/push/subscribe` | SessionView | Subscribe to push notifications |
| POST | `/api/voice/transcribe` | (voice cloud) | Cloud speech-to-text transcription |

### WebSocket Paths

| Path | Used By | Messages Received |
|------|---------|-------------------|
| `/ws/dashboard` | Dashboard | `project-update` (projectId, activeSession, taskSummary, workflow) |
| `/ws/sessions/:id` | SessionView, SpecKitChat | `output`, `state`, `progress`, `phase`, `sync`, `error` |
