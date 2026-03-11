# Agent Runner — Step-by-Step Prompt

## What we're building
A server + PWA system for running agent-framework projects autonomously. The server manages claude processes (both generator interviews and task runners), sandboxes each agent to its project directory, logs all output to files, and exposes a WebSocket + REST API. The PWA is a thin client for monitoring projects, streaming output, starting new projects via voice input, and answering blocked (`[?]`) tasks.

## Tech stack & architecture
- **Server:** Node.js + Express + WebSocket (ws)
- **PWA:** Lightweight frontend (vanilla JS or Preact), Web Speech API for voice input, WebSocket for live streaming, installable on Android
- **Process management:** Server spawns claude CLI processes via `child_process`
- **Sandboxing:** Each agent process runs inside `systemd-run --user` with `ProtectHome=tmpfs` + `BindPaths=<project-dir>` so it can only access its own project directory. Projects use Nix flakes for their dev environment, so agents run via `nix develop <project> --command claude ...`
- **State:** Markdown task/notes files are the source of truth (agent-framework convention). Project registry is a JSON config file at `~/.agent-runner/projects.json`
- **Session logs:** All claude process I/O is logged to `~/.agent-runner/sessions/<session-id>/output.log` for replay on reconnect

### Key paths (target structure)
```
/
├── server/
│   ├── index.ts                    # Express + WebSocket server entry point
│   ├── routes/
│   │   ├── projects.ts             # CRUD for project registry
│   │   ├── sessions.ts             # Start/stop/status of claude processes
│   │   └── interviews.ts           # Generator interview sessions
│   ├── lib/
│   │   ├── process-manager.ts      # Spawn, manage, kill claude processes
│   │   ├── sandbox.ts              # systemd-run sandboxing logic
│   │   ├── session-logger.ts       # Log I/O to files, replay on reconnect
│   │   ├── task-parser.ts          # Parse agent-framework markdown task files
│   │   └── project-registry.ts     # Read/write projects.json
│   └── ws/
│       └── handler.ts              # WebSocket connection handler (stream, input, replay)
├── pwa/
│   ├── index.html                  # App shell
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker (push notifications, offline)
│   ├── app.js                      # Main app logic
│   ├── components/
│   │   ├── project-list.js         # Project dashboard
│   │   ├── session-view.js         # Live output / log replay view
│   │   ├── voice-input.js          # Web Speech API mic button
│   │   └── notification-manager.js # Push notification setup
│   └── styles/
│       └── app.css
├── package.json
├── tsconfig.json
└── flake.nix                       # Nix flake for this project's dev environment
```

## Session model

Every interaction with claude (generator interview or task run) is a **session**:

```typescript
interface Session {
  id: string;                          // UUID
  projectId: string;                   // Which project this belongs to
  type: 'interview' | 'task-run';      // Generator interview or autonomous task execution
  state: 'running' | 'waiting_for_input' | 'completed' | 'failed';
  logFile: string;                     // Path to output.log
  startedAt: Date;
  completedAt?: Date;
}
```

### Session types

**Generator interview (`type: 'interview'`):**
- Server spawns `claude` in interactive mode (not `-p`)
- Pipes the generator-prompt.md (from agent-framework) as the system context
- User's voice input (transcribed on phone via Web Speech API) → sent to server via WebSocket → piped to claude's stdin
- Claude's stdout → logged to file + streamed to PWA via WebSocket
- When interview completes, claude outputs the 3 framework files → server writes them to a new project directory and registers the project

**Task run (`type: 'task-run'`):**
- Server spawns `claude -p --dangerously-skip-permissions` with the project's prompt file content
- Adds instruction: "If no unchecked tasks remain after completing this task, output DONE as your final line. If a task is unclear, mark it `[?]` with the question and move to the next task."
- Output → logged to file + streamed to PWA
- On completion, server parses the task file:
  - If all tasks done → mark session `completed`
  - If `[?]` tasks exist → mark session `waiting_for_input`, notify PWA
  - If unchecked tasks remain → auto-start next run (loop)
- On `DONE` in output → stop looping, mark project complete

### Sandboxing

Every claude process (both interview and task-run) is spawned via:
```bash
systemd-run --user --scope \
  -p ProtectHome=tmpfs \
  -p BindPaths=<project-dir> \
  nix develop <project-dir> --command \
  claude [args]
```

The agent can only see files inside the project directory. No access to other projects, home directory, or system files.

## API design

### REST endpoints
- `GET /api/projects` — list all registered projects with task summary
- `POST /api/projects` — register a new project (path, name, prompt file)
- `DELETE /api/projects/:id` — unregister a project
- `GET /api/projects/:id` — project detail with full task list
- `POST /api/projects/:id/run` — start a task-run session
- `POST /api/projects/:id/stop` — kill the running session
- `GET /api/sessions` — list all sessions (filterable by project, state)
- `GET /api/sessions/:id` — session detail with log content
- `POST /api/interviews` — start a generator interview session

### WebSocket messages

**Client → Server:**
- `{ type: 'subscribe', sessionId: string }` — subscribe to a session's output (replays log first, then streams live)
- `{ type: 'unsubscribe', sessionId: string }` — stop receiving output
- `{ type: 'input', sessionId: string, text: string }` — send user input to an interview session
- `{ type: 'answer', projectId: string, taskId: string, answer: string }` — answer a `[?]` blocked task

**Server → Client:**
- `{ type: 'output', sessionId: string, data: string }` — claude output chunk
- `{ type: 'state-change', sessionId: string, state: string }` — session state changed
- `{ type: 'question', projectId: string, taskId: string, question: string }` — a task needs user input
- `{ type: 'project-update', projectId: string, summary: object }` — task progress changed

## PWA features

### Project dashboard
- List of all registered projects
- Each shows: name, task progress (e.g., "14/18 tasks"), current state (idle, running, waiting for input)
- Tap → project detail with full task list and session history

### Session view
- Live streaming output from a running session
- Or log replay for completed/disconnected sessions
- Auto-scrolls, monospace font, terminal-like appearance

### Voice input
- Mic button using Web Speech API (`webkitSpeechRecognition`)
- Transcribed text sent to server via WebSocket
- Used during generator interviews to talk through project setup
- Visual indicator when listening, shows transcribed text before sending

### Notifications
- Service Worker push notifications when:
  - A task hits `[?]` and needs input
  - A project completes all tasks
  - A session fails

## Reference files
- `memory/agent-runner-tasks.md` — task checklist with progress
- `memory/agent-runner-notes.md` — detailed decisions, architecture notes, reference details

---

## How to work

1. **Read the task list** at `memory/agent-runner-tasks.md` — find the FIRST unchecked task (`- [ ]`)
2. **Read the memory file** at `memory/agent-runner-notes.md` — review decisions, architecture notes, and any blockers from previous sessions
3. **Pre-task review** — Before starting, think about:
   - Does this task have everything it needs? Are there missing details, ambiguous requirements, or design decisions that should be made first?
   - Are there dependencies on earlier tasks that aren't done yet?
   - Will this task affect other tasks or require changes to the plan?
   - Is there anything the user should weigh in on before you start?
   - **If anything is unclear or needs a decision, ASK the user before proceeding.**
4. **Execute that ONE task** — implement it, test it, verify it works
5. **Update the task list** — mark the task `- [x]` with a brief note of what was done
6. **Update the memory file** — add any new findings, decisions, gotchas, or file paths discovered during implementation
7. **Post-task review** — After completing the task, think about:
   - Did anything come up during implementation that changes the plan? (new tasks needed, tasks that should be reordered, tasks that are now unnecessary)
   - Are there open questions or risks for upcoming tasks?
   - Does the next task still make sense, or should something else come first?
   - **Update the task list and memory file with any changes. Flag anything the user should know about.**
8. **Stop and report** — tell the user what you did, what worked, what didn't, what questions came up, and what the next task is

## Rules

- ONE task per invocation. Do not skip ahead.
- If a task is blocked, write the blocker in the memory file, mark the task `- [?]` with the reason, and move to the next unblocked task.
- If you discover a task is unnecessary, mark it `- [~]` with why, and move on.
- If a task needs to be split into subtasks, add them as indented items under the parent task.
- If you discover NEW tasks are needed during implementation, add them to the task list, update the memory file, and note them in the prompt context.
- Always read both files before starting — context from previous sessions matters.
- Prefer minimal changes. Don't refactor unrelated code.
- Test your work before marking complete — run `npm run build` and `npm test` to verify.
- If you need user input (e.g., design decision), ask and do NOT proceed until answered.
- Use conventional commits (e.g., `feat: add session logger`, `fix: websocket reconnect`).
- Do not modify files in `~/.agent-runner/` during development — that's the runtime data directory, not source code.
