// Stub — to be implemented in T057
// This file exports the interface so tests can import and fail (TDD red phase)

export const SPEC_KIT_PHASES = ['specify', 'clarify', 'plan', 'tasks', 'analyze'] as const;

export interface PhaseResult {
  exitCode: number;
}

export interface SpecKitDeps {
  runPhase: (phase: string, projectDir: string, sessionId: string) => Promise<PhaseResult>;
  analyzeHasIssues: (projectDir: string) => Promise<boolean>;
  registerProject: (name: string, dir: string) => Promise<string>;
  launchTaskRun: (projectId: string) => Promise<void>;
  createSessionId: () => string;
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

export async function startNewProjectWorkflow(_options: NewProjectWorkflowOptions): Promise<WorkflowResult> {
  throw new Error('Not implemented — T057');
}

export async function startAddFeatureWorkflow(_options: AddFeatureWorkflowOptions): Promise<WorkflowResult> {
  throw new Error('Not implemented — T057');
}
