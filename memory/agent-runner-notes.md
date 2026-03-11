# Agent Runner — Notes

## Architecture decisions

### Server is the brain, PWA is a thin view
- All claude processes run on the server (the machine with the code)
- PWA is purely a monitoring/input interface — no local processing
- If the phone disconnects, nothing is lost — server keeps running, logs everything
- On reconnect, PWA replays the log from the server

### Markdown files are the database
- No separate database — the agent-framework task/notes markdown files are the source of truth
- Server parses them on demand via the task parser
- Project registry (`~/.agent-runner/projects.json`) is the only server-side state file
- Session logs live at `~/.agent-runner/sessions/<id>/output.log` with a `meta.json`

### Sandboxing via systemd-run
- Each agent process is jailed to its project directory using `systemd-run --user --scope` with `ProtectHome=tmpfs` and `BindPaths=<project-dir>`
- Agents use `nix develop <project-dir> --command` to get the project's toolchain from its flake.nix
- Agents cannot access files outside their project directory
- No resource limits for now — can add `CPUQuota` and `MemoryMax` later if needed
- The flake.nix is per-project, not part of agent-framework — created during scaffolding or manually

### Generator interviews use interactive claude
- Not `claude -p` — needs multi-turn conversation for the interview flow
- Server pipes generator-prompt.md content as the first message
- User voice input → Web Speech API transcription on phone → text sent to server → piped to claude stdin
- Claude stdout → logged + streamed to PWA

### Task runs use headless claude
- `claude -p --dangerously-skip-permissions` with the project prompt
- Extra instruction appended: output DONE when no tasks remain, mark unclear tasks `[?]` and skip
- Server loops automatically: task run finishes → parse task file → start next run if tasks remain
- Loop stops on: DONE in output, all tasks checked, or `[?]` tasks found (waiting for input)

### Voice input, text output
- Web Speech API (`webkitSpeechRecognition`) handles speech-to-text on the device
- No text-to-speech — responses are displayed as text
- Fallback to text input if speech API not available

## Technical reference

### systemd-run sandbox command
```bash
systemd-run --user --scope \
  -p ProtectHome=tmpfs \
  -p BindPaths=/path/to/project \
  nix develop /path/to/project --command \
  claude -p --dangerously-skip-permissions "prompt here"
```

### Agent-framework task file format
```markdown
- [ ] 1.1 Task description — not started
- [x] 1.1 Task description — Done: what was done
- [?] 1.2 Task description — Blocked: reason/question
- [~] 1.3 Task description — Skipped: why
```

### Project registry format (`~/.agent-runner/projects.json`)
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "blog",
      "path": "/home/max/git/blog",
      "promptFile": "blog-prompt.md",
      "createdAt": "2026-03-11T..."
    }
  ]
}
```

### Session metadata format (`~/.agent-runner/sessions/<id>/meta.json`)
```json
{
  "id": "uuid",
  "projectId": "project-uuid",
  "type": "task-run",
  "state": "completed",
  "startedAt": "2026-03-11T...",
  "completedAt": "2026-03-11T..."
}
```

### Web Speech API usage
```javascript
const recognition = new webkitSpeechRecognition();
recognition.continuous = false;
recognition.interimResults = true;
recognition.lang = 'en-US';
recognition.onresult = (event) => { /* send transcript to server */ };
```

### Key npm packages
- `express` — HTTP server
- `ws` — WebSocket server
- `uuid` — session/project IDs
- `typescript` + `tsx` — TypeScript dev/runtime

## Key references
- Agent-framework repo: `/home/max/git/agent-framework`
- Generator prompt: `/home/max/git/agent-framework/generator-prompt.md`
- Feature prompt: `/home/max/git/agent-framework/feature-prompt.md`
- Blog project (test target): `/home/max/git/blog`
- Blog prompt: `/home/max/git/blog/blog-prompt.md`
- Runtime data: `~/.agent-runner/`

## Open questions
- None currently — all decisions made during initial planning session.
