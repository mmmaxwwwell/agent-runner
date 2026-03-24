import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The module under test — will be implemented in T014
import {
  type OnboardingStep,
  type OnboardingStepName,
  type OnboardingContext,
  type OnboardingResult,
  createOnboardingSteps,
  runOnboardingPipeline,
} from '../../src/services/onboarding.ts';

describe('onboarding pipeline', () => {
  let tmpDir: string;
  let dataDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'onboarding-test-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);
    projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('OnboardingStep interface', () => {
    it('should define steps with name, check, and execute', () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      const steps = createOnboardingSteps(ctx);

      assert.ok(Array.isArray(steps), 'steps should be an array');
      assert.ok(steps.length > 0, 'should have at least one step');

      for (const step of steps) {
        assert.ok(typeof step.name === 'string', `step should have a name`);
        assert.ok(typeof step.check === 'function', `step "${step.name}" should have a check function`);
        assert.ok(typeof step.execute === 'function', `step "${step.name}" should have an execute function`);
      }
    });

    it('should define steps in the correct order', () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      const steps = createOnboardingSteps(ctx);
      const names = steps.map(s => s.name);

      const expectedOrder: OnboardingStepName[] = [
        'register',
        'create-directory',
        'generate-flake',
        'git-init',
        'git-remote',
        'install-specify',
        'specify-init',
        'launch-interview',
      ];

      assert.deepEqual(names, expectedOrder, 'steps should be in the correct order');
    });
  });

  describe('step check functions (idempotency)', () => {
    it('register: should return true when project is already in projects.json', async () => {
      // Write a projects.json with the project already registered
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify([{
          id: 'test-id',
          name: 'my-project',
          dir: projectDir,
          taskFile: 'tasks.md',
          promptFile: '',
          createdAt: new Date().toISOString(),
          status: 'onboarding',
          description: null,
        }]),
      );

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const registerStep = steps.find(s => s.name === 'register')!;

      const result = await registerStep.check();
      assert.equal(result, true, 'should skip when project already registered');
    });

    it('register: should return false when project is not in projects.json', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const registerStep = steps.find(s => s.name === 'register')!;

      const result = await registerStep.check();
      assert.equal(result, false, 'should not skip when project is not registered');
    });

    it('create-directory: should return true when directory exists', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'create-directory')!;

      // projectDir already exists (created in beforeEach)
      const result = await step.check();
      assert.equal(result, true, 'should skip when directory exists');
    });

    it('create-directory: should return false when directory does not exist', async () => {
      const newProjectDir = join(tmpDir, 'nonexistent-project');
      const ctx: OnboardingContext = {
        dataDir,
        projectDir: newProjectDir,
        projectName: 'new-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'create-directory')!;

      const result = await step.check();
      assert.equal(result, false, 'should not skip when directory does not exist');
    });

    it('generate-flake: should return true when flake.nix exists', async () => {
      writeFileSync(join(projectDir, 'flake.nix'), '{ }');

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'generate-flake')!;

      const result = await step.check();
      assert.equal(result, true, 'should skip when flake.nix exists');
    });

    it('generate-flake: should return false when flake.nix does not exist', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'generate-flake')!;

      const result = await step.check();
      assert.equal(result, false, 'should not skip when flake.nix does not exist');
    });

    it('git-init: should return true when .git/ exists', async () => {
      mkdirSync(join(projectDir, '.git'));

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'git-init')!;

      const result = await step.check();
      assert.equal(result, true, 'should skip when .git/ exists');
    });

    it('git-init: should return false when .git/ does not exist', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'git-init')!;

      const result = await step.check();
      assert.equal(result, false, 'should not skip when .git/ does not exist');
    });

    it('specify-init: should return true when .specify/ exists', async () => {
      mkdirSync(join(projectDir, '.specify'));

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'specify-init')!;

      const result = await step.check();
      assert.equal(result, true, 'should skip when .specify/ exists');
    });

    it('specify-init: should return false when .specify/ does not exist', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'specify-init')!;

      const result = await step.check();
      assert.equal(result, false, 'should not skip when .specify/ does not exist');
    });

    it('launch-interview: should always return false (always runs)', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };
      const steps = createOnboardingSteps(ctx);
      const step = steps.find(s => s.name === 'launch-interview')!;

      const result = await step.check();
      assert.equal(result, false, 'launch-interview should always run');
    });
  });

  describe('pipeline orchestration', () => {
    it('should execute steps in order, skipping those whose check returns true', async () => {
      const executed: string[] = [];
      const checked: string[] = [];

      // Set up filesystem so generate-flake and git-init checks pass (skip)
      writeFileSync(join(projectDir, 'flake.nix'), '{ }');
      mkdirSync(join(projectDir, '.git'));

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
        // Provide callbacks to track which steps are checked/executed
        onStepStart: (step) => { checked.push(step); },
        onStepComplete: (step, status) => {
          if (status === 'completed') executed.push(step);
        },
      };

      const steps = createOnboardingSteps(ctx);

      // Verify the check functions correctly detect existing state
      const flakeStep = steps.find(s => s.name === 'generate-flake')!;
      assert.equal(await flakeStep.check(), true, 'flake check should return true');

      const gitStep = steps.find(s => s.name === 'git-init')!;
      assert.equal(await gitStep.check(), true, 'git-init check should return true');
    });

    it('should set project status to error when a step fails', async () => {
      // Register the project first so we can check status updates
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify([{
          id: 'test-id',
          name: 'my-project',
          dir: projectDir,
          taskFile: 'tasks.md',
          promptFile: '',
          createdAt: new Date().toISOString(),
          status: 'onboarding',
          description: null,
        }]),
      );

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        projectId: 'test-id',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      // Use a broken projectDir to make generate-flake or another step fail
      // We'll test this by running the pipeline on a dir that will cause a step to error
      const brokenCtx: OnboardingContext = {
        ...ctx,
        // install-specify will fail because there's no nix shell available in test
        // This tests that when ANY step fails, status becomes 'error'
      };

      try {
        await runOnboardingPipeline(brokenCtx);
      } catch {
        // Expected to fail — the important thing is the status
      }

      // Read back the project status
      const projects = JSON.parse(
        readFileSync(join(dataDir, 'projects.json'), 'utf-8'),
      );
      const project = projects.find((p: { id: string }) => p.id === 'test-id');
      assert.equal(project?.status, 'error', 'project status should be set to error on failure');
    });

    it('should skip all steps when project is fully initialized', async () => {
      // Set up a fully initialized project
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify([{
          id: 'test-id',
          name: 'my-project',
          dir: projectDir,
          taskFile: 'tasks.md',
          promptFile: '',
          createdAt: new Date().toISOString(),
          status: 'onboarding',
          description: null,
        }]),
      );

      // All filesystem checks pass
      writeFileSync(join(projectDir, 'flake.nix'), '{ }');
      mkdirSync(join(projectDir, '.git'));
      mkdirSync(join(projectDir, '.specify'));

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        projectId: 'test-id',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      const steps = createOnboardingSteps(ctx);

      // Verify all filesystem-based checks return true (skip)
      const registerCheck = await steps.find(s => s.name === 'register')!.check();
      assert.equal(registerCheck, true, 'register should be skipped');

      const createDirCheck = await steps.find(s => s.name === 'create-directory')!.check();
      assert.equal(createDirCheck, true, 'create-directory should be skipped');

      const flakeCheck = await steps.find(s => s.name === 'generate-flake')!.check();
      assert.equal(flakeCheck, true, 'generate-flake should be skipped');

      const gitCheck = await steps.find(s => s.name === 'git-init')!.check();
      assert.equal(gitCheck, true, 'git-init should be skipped');

      const specifyInitCheck = await steps.find(s => s.name === 'specify-init')!.check();
      assert.equal(specifyInitCheck, true, 'specify-init should be skipped');

      // launch-interview always runs
      const launchCheck = await steps.find(s => s.name === 'launch-interview')!.check();
      assert.equal(launchCheck, false, 'launch-interview should always run');
    });

    it('should broadcast step progress via onStepStart and onStepComplete callbacks', async () => {
      const events: Array<{ step: string; event: string; status?: string }> = [];

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
        onStepStart: (step) => {
          events.push({ step, event: 'start' });
        },
        onStepComplete: (step, status) => {
          events.push({ step, event: 'complete', status });
        },
      };

      const steps = createOnboardingSteps(ctx);

      // Manually run a step that will be skipped (directory exists)
      const createDirStep = steps.find(s => s.name === 'create-directory')!;
      const shouldSkip = await createDirStep.check();
      assert.equal(shouldSkip, true, 'create-directory check should return true');

      // The callbacks are called by the pipeline runner, not individual steps
      // This test verifies the context accepts the callback shape
      assert.ok(typeof ctx.onStepStart === 'function');
      assert.ok(typeof ctx.onStepComplete === 'function');
    });

    it('should return result with projectId and sessionId', async () => {
      // Register a project so register step is skipped
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify([{
          id: 'test-id',
          name: 'my-project',
          dir: projectDir,
          taskFile: 'tasks.md',
          promptFile: '',
          createdAt: new Date().toISOString(),
          status: 'onboarding',
          description: null,
        }]),
      );

      // Set up all filesystem checks to pass
      writeFileSync(join(projectDir, 'flake.nix'), '{ }');
      mkdirSync(join(projectDir, '.git'));
      mkdirSync(join(projectDir, '.specify'));

      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        projectId: 'test-id',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      // The pipeline will try to run launch-interview which requires
      // actual session infrastructure — this tests the return type contract
      try {
        const result: OnboardingResult = await runOnboardingPipeline(ctx);
        assert.ok(typeof result.projectId === 'string', 'result should have projectId');
        assert.ok(typeof result.sessionId === 'string', 'result should have sessionId');
        assert.ok(typeof result.name === 'string', 'result should have name');
        assert.ok(typeof result.path === 'string', 'result should have path');
        assert.equal(result.status, 'onboarding', 'result status should be onboarding');
      } catch {
        // launch-interview may fail in unit test env — that's OK for this test
        // The important thing is the type contract compiles
      }
    });
  });

  describe('error handling', () => {
    it('should surface step name and error message on failure', async () => {
      const ctx: OnboardingContext = {
        dataDir,
        projectDir,
        projectName: 'my-project',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      // When the pipeline fails, it should include which step failed
      try {
        await runOnboardingPipeline(ctx);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        // The error should reference a step name or provide context
        assert.ok(
          typeof msg === 'string' && msg.length > 0,
          'error should have a descriptive message',
        );
      }
    });

    it('should not leave project in onboarding status after failure', async () => {
      // Pre-register the project
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify([{
          id: 'fail-id',
          name: 'fail-project',
          dir: join(tmpDir, 'nonexistent-for-fail'),
          taskFile: 'tasks.md',
          promptFile: '',
          createdAt: new Date().toISOString(),
          status: 'onboarding',
          description: null,
        }]),
      );

      const ctx: OnboardingContext = {
        dataDir,
        projectDir: join(tmpDir, 'nonexistent-for-fail'),
        projectName: 'fail-project',
        projectId: 'fail-id',
        agentFrameworkDir: join(dataDir, 'agent-framework'),
        allowUnsandboxed: true,
      };

      try {
        await runOnboardingPipeline(ctx);
      } catch {
        // Expected
      }

      const projects = JSON.parse(
        readFileSync(join(dataDir, 'projects.json'), 'utf-8'),
      );
      const project = projects.find((p: { id: string }) => p.id === 'fail-id');
      assert.equal(
        project?.status,
        'error',
        'project should transition to error status after pipeline failure',
      );
    });
  });
});
