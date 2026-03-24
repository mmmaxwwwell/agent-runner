// Onboarding pipeline service — idempotent step pipeline for project initialization

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { listProjects, registerForOnboarding, updateProjectStatus } from '../models/project.js';
import { createSession, listSessionsByProject } from '../models/session.js';
import { ensureFlakeNix } from './flake-generator.js';
import { buildCommand } from './sandbox.js';
import { spawnProcess } from './process-manager.js';
import { registerProcess } from './process-registry.js';
import { createSessionLogger } from './session-logger.js';

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

// Mutable state passed between steps during pipeline execution
interface PipelineState {
  projectId: string | undefined;
  sessionId: string | undefined;
}

export function createOnboardingSteps(ctx: OnboardingContext): OnboardingStep[] {
  const state: PipelineState = {
    projectId: ctx.projectId,
    sessionId: undefined,
  };

  return [
    {
      name: 'register',
      check: () => {
        const projects = listProjects(ctx.dataDir);
        return projects.some(p => resolve(p.dir) === resolve(ctx.projectDir));
      },
      execute: async () => {
        const project = registerForOnboarding(ctx.dataDir, {
          name: ctx.projectName,
          dir: ctx.projectDir,
        });
        state.projectId = project.id;
      },
    },
    {
      name: 'create-directory',
      check: () => existsSync(ctx.projectDir),
      execute: async () => {
        mkdirSync(ctx.projectDir, { recursive: true });
      },
    },
    {
      name: 'generate-flake',
      check: () => existsSync(join(ctx.projectDir, 'flake.nix')),
      execute: async () => {
        ensureFlakeNix(ctx.projectDir);
      },
    },
    {
      name: 'git-init',
      check: () => existsSync(join(ctx.projectDir, '.git')),
      execute: async () => {
        execFileSync('git', ['init', ctx.projectDir], { stdio: 'pipe' });
      },
    },
    {
      name: 'install-specify',
      check: () => {
        // Cannot easily check `which specify` inside sandbox synchronously.
        // Always execute — uv tool install is idempotent.
        return false;
      },
      execute: async () => {
        // Install specify-cli via uv inside nix develop
        execFileSync('nix', [
          'develop', ctx.projectDir, '--command',
          'uv', 'tool', 'install', 'specify-cli',
          '--from', 'git+https://github.com/github/spec-kit.git',
        ], { stdio: 'pipe', timeout: 120_000 });
      },
    },
    {
      name: 'specify-init',
      check: () => existsSync(join(ctx.projectDir, '.specify')),
      execute: async () => {
        execFileSync('nix', [
          'develop', ctx.projectDir, '--command',
          'specify', 'init',
        ], { stdio: 'pipe', cwd: ctx.projectDir, timeout: 60_000 });
      },
    },
    {
      name: 'launch-interview',
      check: () => false, // Always runs
      execute: async () => {
        // Resolve projectId — either from register step or ctx
        const projectId = state.projectId ?? ctx.projectId;
        if (!projectId) {
          throw new Error('No projectId available for launch-interview step');
        }

        // Create a session for the interview
        const session = createSession(ctx.dataDir, {
          projectId,
          type: 'interview',
        });

        // Build sandbox command for interview
        const sandboxCmd = buildCommand(ctx.projectDir, 'interview', {
          agentFrameworkDir: ctx.agentFrameworkDir,
          allowUnsandboxed: ctx.allowUnsandboxed,
        });

        // Spawn the interview process
        const logPath = join(ctx.dataDir, 'sessions', session.id, 'output.jsonl');
        const logger = createSessionLogger(logPath);

        const handle = spawnProcess({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          sessionId: session.id,
          logger,
          dataDir: ctx.dataDir,
        });

        registerProcess(session.id, handle);
        state.sessionId = session.id;
      },
    },
  ];
}

export async function runOnboardingPipeline(ctx: OnboardingContext): Promise<OnboardingResult> {
  const steps = createOnboardingSteps(ctx);

  // Track projectId across steps (register may set it)
  let projectId = ctx.projectId;
  let sessionId: string | undefined;

  for (const step of steps) {
    ctx.onStepStart?.(step.name);

    try {
      const alreadyDone = await step.check();
      if (alreadyDone) {
        ctx.onStepComplete?.(step.name, 'skipped');
        // If register was skipped, resolve projectId from existing projects
        if (step.name === 'register' && !projectId) {
          const projects = listProjects(ctx.dataDir);
          const existing = projects.find(p => resolve(p.dir) === resolve(ctx.projectDir));
          if (existing) projectId = existing.id;
        }
        continue;
      }

      await step.execute();
      ctx.onStepComplete?.(step.name, 'completed');

      // Capture projectId from register step
      if (step.name === 'register' && !projectId) {
        const projects = listProjects(ctx.dataDir);
        const registered = projects.find(p => resolve(p.dir) === resolve(ctx.projectDir));
        if (registered) projectId = registered.id;
      }

    } catch (err) {
      ctx.onStepComplete?.(step.name, 'error');

      // Set project status to error if we have a projectId
      if (projectId) {
        try {
          updateProjectStatus(ctx.dataDir, projectId, 'error');
        } catch {
          // Status update failure shouldn't mask the original error
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Onboarding step "${step.name}" failed: ${msg}`);
    }
  }

  // After all steps, resolve sessionId from the last created session
  if (!sessionId && projectId) {
    const sessions = listSessionsByProject(ctx.dataDir, projectId);
    const running = sessions.find(s => s.state === 'running');
    if (running) sessionId = running.id;
  }

  if (!projectId) {
    throw new Error('Pipeline completed but no projectId was resolved');
  }

  return {
    projectId,
    sessionId: sessionId ?? '',
    name: ctx.projectName,
    path: ctx.projectDir,
    status: 'onboarding',
  };
}
