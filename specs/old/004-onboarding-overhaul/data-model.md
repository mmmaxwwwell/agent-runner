# Data Model: Onboarding Overhaul

## Modified Entities

### Config

Existing config interface with changes:

```typescript
interface Config {
  host: string;
  port: number;
  dataDir: string;                    // DEFAULT CHANGED: ~/.local/share/agent-runner/
  projectsDir: string;                // unchanged: ~/git
  logLevel: LogLevel;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  allowUnsandboxed: boolean;
  googleSttApiKey: string | null;
  diskWarnThresholdMb: number;
  agentFrameworkDir: string;          // NEW — derived: <dataDir>/agent-framework/
}
```

**New constant** (not configurable):
```typescript
const AGENT_FRAMEWORK_REPO = 'https://github.com/mmmaxwwwell/agent-framework';
```

### Project

Existing project model with additions:

```typescript
interface Project {
  id: string;
  name: string;
  dir: string;
  taskFile: string;
  promptFile: string;
  createdAt: string;
  status: 'active' | 'onboarding' | 'error';
  description: string | null;         // NEW — agent-generated after interview
}
```

**State transitions:**
- Created → `onboarding` (registration during onboarding flow)
- `onboarding` → `active` (interview completes, user signals readiness)
- `onboarding` → `error` (initialization step fails)
- `error` → `onboarding` (re-trigger onboard, retry from failed step)

### SandboxCommand

Extended return type:

```typescript
interface SandboxCommand {
  command: string;
  args: string[];
  unsandboxed: boolean;
}
```

No structural change, but `buildCommand()` signature changes:

```typescript
// OLD
function buildCommand(
  projectDir: string,
  claudeArgs: string[],
  allowUnsandboxed: boolean,
  options?: BuildCommandOptions,
): SandboxCommand

// NEW
function buildCommand(
  projectDir: string,
  sessionType: 'interview' | 'task-run',
  options: {
    allowUnsandboxed?: boolean;
    prompt?: string;             // Initial prompt for -p flag
    agentFrameworkDir: string;   // Path to agent-framework clone
    sandboxAvailable?: boolean;  // For testing
  },
): SandboxCommand
```

**Preset flags by session type:**

| Flag | Interview | Task-Run |
|------|-----------|----------|
| `--output-format stream-json` | Yes | Yes |
| `--dangerously-skip-permissions` | Yes | Yes |
| `--model opus` | Yes | Yes |
| `-p <prompt>` | Optional (if prompt provided) | Required |

**Sandbox properties (full list):**

| Property | Value | Notes |
|----------|-------|-------|
| `ProtectHome` | `tmpfs` | Isolate home directory |
| `BindPaths` | `{projectDir} {homedir}/.cache/nix {homedir}/.local/share/uv` | Project + nix cache + uv cache |
| `BindReadOnlyPaths` | `{agentFrameworkDir}` | Agent framework skills (read-only) |
| `ProtectSystem` | `strict` | Read-only system directories |
| `NoNewPrivileges` | `yes` | No privilege escalation |
| `PrivateDevices` | `yes` | Minimal /dev |
| `PrivateTmp` | `yes` | Private /tmp |

**Nix shell wrapper:**
```
nix shell github:NixOS/nixpkgs/nixpkgs-unstable#claude-code \
         github:NixOS/nixpkgs/nixpkgs-unstable#uv \
  --command nix develop {projectDir} --command claude <preset-flags> <claude-args>
```

## New Entities

### TranscriptParser

Server-side service that watches `output.jsonl` and writes `transcript.md`:

```typescript
interface TranscriptParserOptions {
  outputJsonlPath: string;     // Path to session output.jsonl
  transcriptPath: string;      // Path to write transcript.md
  pollIntervalMs?: number;     // Default: 200ms
}

interface TranscriptParser {
  start(): void;
  stop(): void;
}
```

**Input format** (Claude CLI stream-json, from output.jsonl):
```jsonc
// Agent output — extract text blocks
{"ts":..., "stream":"stdout", "seq":1, "content":"{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Hello\"}]}}"}

// User input — forwarded from stdin
{"ts":..., "stream":"stdin", "seq":2, "content":"my project idea"}

// System messages — skip
{"ts":..., "stream":"system", "seq":3, "content":"User answered: ..."}
```

**Output format** (`transcript.md`):
```markdown
# Interview Transcript

## Agent
Hello, I'll help you specify your project...

## User
my project idea

## Agent
That's interesting. Let me research similar projects...
```

### OnboardingStep

Represents an initialization step in the onboarding pipeline:

```typescript
type OnboardingStepName =
  | 'register'
  | 'create-directory'
  | 'generate-flake'
  | 'git-init'
  | 'install-specify'
  | 'specify-init'
  | 'launch-interview';

interface OnboardingStep {
  name: OnboardingStepName;
  check: (projectDir: string) => boolean | Promise<boolean>;  // Is this step already done?
  execute: (projectDir: string) => Promise<void>;              // Run the step
}
```

**Step checks (idempotency):**

| Step | Check (skip if true) |
|------|---------------------|
| register | Project already in projects.json |
| create-directory | Directory exists on disk |
| generate-flake | `flake.nix` exists in project dir |
| git-init | `.git/` exists in project dir |
| install-specify | `which specify` succeeds in nix shell |
| specify-init | `.specify/` exists in project dir |
| launch-interview | Always runs (creates session) |

### InterviewWrapperPrompt

Not a data entity — a markdown file at `.claude/skills/spec-kit/interview-wrapper.md` in the agent-framework repo. Read by the server and passed via `-p` to the Claude process.

**Content structure:**
```markdown
# Spec-Kit Exhaustive Interview

You are conducting a specification interview for a new project/feature.

## Your Approach
- Read the spec-kit specify and clarify templates from .specify/commands/
- Research similar projects on the web for inspiration
- Ask exhaustive questions — do NOT stop at 5
- Suggest features the user hasn't thought of
- Probe edge cases, error handling, deployment, auth, observability
- Continue looping specify → clarify until the spec is comprehensive

## When Satisfied
- Ask the user if they're ready to move to planning
- Do NOT auto-advance
- Write interview-notes.md with key decisions, rejected alternatives, priorities
- Write the agent-generated project description

## Recovery
- If transcript.md exists, read it for prior conversation context
- If spec.md exists, continue from where it left off
```

## File Layout

### Data Directory (`~/.local/share/agent-runner/`)

```text
~/.local/share/agent-runner/
├── projects.json                    # Project registry
├── vapid-keys.json                  # Push notification keys
├── agent-framework/                 # NEW — managed git clone
│   ├── .claude/skills/spec-kit/
│   │   ├── SKILL.md
│   │   ├── interview-wrapper.md     # NEW — interview prompt
│   │   └── run-tasks.sh
│   ├── ROUTER.md
│   └── ...
└── sessions/
    └── {sessionId}/
        ├── meta.json
        └── output.jsonl
```

### Project Directory (per project)

```text
{projectDir}/
├── flake.nix                        # Generated if missing
├── .git/                            # Initialized if missing
├── .specify/                        # Initialized if missing
│   ├── memory/constitution.md
│   ├── scripts/
│   └── templates/
└── specs/{feature-name}/
    ├── spec.md                      # Written by interview agent
    ├── transcript.md                # NEW — written by server-side parser
    ├── interview-notes.md           # NEW — written by agent at interview end
    ├── plan.md                      # Written by plan session
    ├── research.md
    ├── data-model.md
    └── tasks.md                     # Written by tasks session
```

## API Changes

### Modified Endpoints

**`POST /api/projects/onboard`** — Unified onboarding (absorbs new-project workflow):

Request:
```typescript
{
  name?: string;           // Optional — derived from directory basename if omitted
  path?: string;           // Required for discovered dirs, omitted for new projects
  newProject?: boolean;    // If true, create directory under projectsDir
  remoteUrl?: string;      // Optional — git remote URL
  createGithubRepo?: boolean;  // Optional — create via gh repo create
}
```

Response:
```typescript
{
  projectId: string;
  sessionId: string;       // Interview session ID
  name: string;
  path: string;
  status: 'onboarding';
}
```

**`POST /api/workflows/new-project`** — Deprecated/removed, unified into onboard.

### New WebSocket Messages

**Phase transition for onboarding steps:**
```typescript
{
  type: 'onboarding-step';
  projectId: string;
  step: OnboardingStepName;
  status: 'running' | 'completed' | 'skipped' | 'error';
  error?: string;
}
```
