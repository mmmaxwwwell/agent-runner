// Onboarding pipeline service — stub for T012 (tests), implementation in T014

export type OnboardingStepName =
  | 'register'
  | 'create-directory'
  | 'generate-flake'
  | 'git-init'
  | 'install-specify'
  | 'specify-init'
  | 'launch-interview';

export interface OnboardingStep {
  name: OnboardingStepName;
  check: () => boolean | Promise<boolean>;
  execute: () => Promise<void>;
}

export interface OnboardingContext {
  dataDir: string;
  projectDir: string;
  projectName: string;
  projectId?: string;
  agentFrameworkDir: string;
  allowUnsandboxed: boolean;
  onStepStart?: (step: OnboardingStepName) => void;
  onStepComplete?: (step: OnboardingStepName, status: 'completed' | 'skipped' | 'error') => void;
}

export interface OnboardingResult {
  projectId: string;
  sessionId: string;
  name: string;
  path: string;
  status: 'onboarding';
}

export function createOnboardingSteps(_ctx: OnboardingContext): OnboardingStep[] {
  throw new Error('Not implemented — waiting for T014');
}

export async function runOnboardingPipeline(_ctx: OnboardingContext): Promise<OnboardingResult> {
  throw new Error('Not implemented — waiting for T014');
}
