import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFlakeNix } from './flake-generator.js';

export const SPEC_KIT_PHASES = ['interview', 'plan', 'tasks', 'analyze'] as const;

const INTERVIEW_WRAPPER_PATH = '.claude/skills/spec-kit/interview-wrapper.md';

const MAX_ANALYZE_ITERATIONS = 5;

/**
 * Build a prompt for post-interview phases (plan, tasks, analyze) that instructs
 * the agent to read interview context files before executing the phase.
 */
function buildPhasePrompt(phase: string): string {
  const contextInstructions = `Before executing this phase, read the following files from the spec directory for full interview context:
- spec.md — the feature specification written during the interview
- interview-notes.md — summary of key decisions, rejected alternatives, and user priorities
- transcript.md — full conversation record from the interview session

Use the information from these files to inform your work in this phase.`;

  switch (phase) {
    case 'plan':
      return `${contextInstructions}

Now execute the spec-kit plan phase: generate plan.md, data-model.md, and research.md based on the specification and interview context. Use /speckit.plan to drive the planning workflow.`;
    case 'tasks':
      return `${contextInstructions}

Now execute the spec-kit tasks phase: generate tasks.md with dependency-ordered, phased tasks based on the plan and specification. Use /speckit.tasks to drive the task generation workflow.`;
    case 'analyze':
      return `${contextInstructions}

Now execute the spec-kit analyze phase: perform a cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md. Use /speckit.analyze to drive the analysis workflow. If issues are found, fix them.`;
    default:
      return contextInstructions;
  }
}

export interface PhaseResult {
  exitCode: number;
}

export interface PhaseTransitionEvent {
  workflow: 'new-project' | 'add-feature';
  phase: string;
  previousPhase: string | null;
  iteration: number;
  maxIterations: number;
  sessionId: string;
}

export interface SpecKitDeps {
  runPhase: (phase: string, projectDir: string, sessionId: string, prompt?: string) => Promise<PhaseResult>;
  analyzeHasIssues: (projectDir: string) => Promise<boolean>;
  registerProject: (name: string, dir: string) => Promise<string>;
  launchTaskRun: (projectId: string) => Promise<void>;
  createSessionId: () => string;
  onPhaseTransition?: (event: PhaseTransitionEvent) => void;
  /** Tracking array for tests — records which phases were run */
  phasesRun?: string[];
}

export interface NewProjectWorkflowOptions {
  repoName: string;
  description: string;
  projectsDir: string;
  dataDir: string;
  agentFrameworkDir: string;
  deps: SpecKitDeps;
}

export interface AddFeatureWorkflowOptions {
  projectId: string;
  projectDir: string;
  description: string;
  dataDir: string;
  agentFrameworkDir: string;
  deps: SpecKitDeps;
}

export interface WorkflowResult {
  outcome: 'completed' | 'failed' | 'analyze-cap-reached';
  completedPhases?: string[];
  failedPhase?: string;
  projectId?: string;
  analyzeIterations?: number;
}

/**
 * Read the interview wrapper prompt from the agent-framework directory.
 */
export function readInterviewPrompt(agentFrameworkDir: string): string {
  const promptPath = join(agentFrameworkDir, INTERVIEW_WRAPPER_PATH);
  return readFileSync(promptPath, 'utf-8');
}

/**
 * Run the spec-kit SDD workflow phases in order, with analyze-remediate loop.
 *
 * The interview phase replaces the old specify→clarify multi-session loop with
 * a single long-running Claude session that conducts an exhaustive spec-kit
 * interview. Plan, tasks, and analyze remain as separate sessions.
 */
async function runWorkflow(projectDir: string, workflowType: 'new-project' | 'add-feature', agentFrameworkDir: string, deps: SpecKitDeps): Promise<WorkflowResult> {
  const completedPhases: string[] = [];
  const preAnalyzePhases = SPEC_KIT_PHASES.filter(p => p !== 'analyze');

  // Read the interview wrapper prompt for the interview phase
  const interviewPrompt = readInterviewPrompt(agentFrameworkDir);

  // Run interview → plan → tasks
  let previousPhase: string | null = null;
  for (const phase of preAnalyzePhases) {
    const sessionId = deps.createSessionId();
    deps.onPhaseTransition?.({
      workflow: workflowType,
      phase,
      previousPhase,
      iteration: 1,
      maxIterations: 1,
      sessionId,
    });
    // Pass the interview wrapper prompt for the interview phase,
    // or context-loading prompts for plan/tasks phases (FR-042)
    const prompt = phase === 'interview' ? interviewPrompt : buildPhasePrompt(phase);
    const result = await deps.runPhase(phase, projectDir, sessionId, prompt);
    if (result.exitCode !== 0) {
      return { outcome: 'failed', failedPhase: phase, completedPhases };
    }
    completedPhases.push(phase);
    previousPhase = phase;
  }

  // Run analyze with remediation loop (capped at MAX_ANALYZE_ITERATIONS)
  let analyzeIterations = 0;
  while (analyzeIterations < MAX_ANALYZE_ITERATIONS) {
    analyzeIterations++;
    const sessionId = deps.createSessionId();
    deps.onPhaseTransition?.({
      workflow: workflowType,
      phase: 'analyze',
      previousPhase,
      iteration: analyzeIterations,
      maxIterations: MAX_ANALYZE_ITERATIONS,
      sessionId,
    });
    const result = await deps.runPhase('analyze', projectDir, sessionId, buildPhasePrompt('analyze'));
    if (result.exitCode !== 0) {
      return { outcome: 'failed', failedPhase: 'analyze', completedPhases, analyzeIterations };
    }
    completedPhases.push('analyze');
    previousPhase = 'analyze';

    const hasIssues = await deps.analyzeHasIssues(projectDir);
    if (!hasIssues) {
      return { outcome: 'completed', completedPhases, analyzeIterations };
    }
  }

  // Cap reached — issues persist after MAX_ANALYZE_ITERATIONS
  return { outcome: 'analyze-cap-reached', completedPhases, analyzeIterations };
}

export async function startNewProjectWorkflow(options: NewProjectWorkflowOptions): Promise<WorkflowResult> {
  const { repoName, projectsDir, agentFrameworkDir, deps } = options;
  const projectDir = join(projectsDir, repoName);

  // Create project directory and ensure it has a flake.nix for nix develop
  mkdirSync(projectDir, { recursive: true });
  ensureFlakeNix(projectDir);

  const result = await runWorkflow(projectDir, 'new-project', agentFrameworkDir, deps);

  if (result.outcome === 'completed') {
    // Auto-register project and launch autonomous implementation
    const projectId = await deps.registerProject(repoName, projectDir);
    result.projectId = projectId;
    await deps.launchTaskRun(projectId);
  }

  return result;
}

export async function startAddFeatureWorkflow(options: AddFeatureWorkflowOptions): Promise<WorkflowResult> {
  const { projectId, projectDir, agentFrameworkDir, deps } = options;

  const result = await runWorkflow(projectDir, 'add-feature', agentFrameworkDir, deps);

  if (result.outcome === 'completed') {
    // No registration needed — project already exists. Launch task run.
    result.projectId = projectId;
    await deps.launchTaskRun(projectId);
  }

  return result;
}
