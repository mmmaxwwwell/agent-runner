import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFlakeNix } from './flake-generator.js';

export const SPEC_KIT_PHASES = ['specify', 'clarify', 'plan', 'tasks', 'analyze'] as const;

const MAX_ANALYZE_ITERATIONS = 5;

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
  runPhase: (phase: string, projectDir: string, sessionId: string) => Promise<PhaseResult>;
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
  deps: SpecKitDeps;
}

export interface AddFeatureWorkflowOptions {
  projectId: string;
  projectDir: string;
  description: string;
  dataDir: string;
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
 * Run the spec-kit SDD workflow phases in order, with analyze-remediate loop.
 * Returns the workflow result including which phases completed and analyze iteration count.
 */
async function runWorkflow(projectDir: string, workflowType: 'new-project' | 'add-feature', deps: SpecKitDeps): Promise<WorkflowResult> {
  const completedPhases: string[] = [];
  const preAnalyzePhases = SPEC_KIT_PHASES.filter(p => p !== 'analyze');

  // Run specify → clarify → plan → tasks
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
    const result = await deps.runPhase(phase, projectDir, sessionId);
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
    const result = await deps.runPhase('analyze', projectDir, sessionId);
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
  const { repoName, projectsDir, deps } = options;
  const projectDir = join(projectsDir, repoName);

  // Create project directory and ensure it has a flake.nix for nix develop
  mkdirSync(projectDir, { recursive: true });
  ensureFlakeNix(projectDir);

  const result = await runWorkflow(projectDir, 'new-project', deps);

  if (result.outcome === 'completed') {
    // Auto-register project and launch autonomous implementation
    const projectId = await deps.registerProject(repoName, projectDir);
    result.projectId = projectId;
    await deps.launchTaskRun(projectId);
  }

  return result;
}

export async function startAddFeatureWorkflow(options: AddFeatureWorkflowOptions): Promise<WorkflowResult> {
  const { projectId, projectDir, deps } = options;

  const result = await runWorkflow(projectDir, 'add-feature', deps);

  if (result.outcome === 'completed') {
    // No registration needed — project already exists. Launch task run.
    result.projectId = projectId;
    await deps.launchTaskRun(projectId);
  }

  return result;
}
