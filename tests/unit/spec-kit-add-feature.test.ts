import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  startAddFeatureWorkflow,
  SPEC_KIT_PHASES,
  type SpecKitDeps,
  type PhaseResult,
} from '../../src/services/spec-kit.ts';

describe('add-feature workflow (US7)', () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spec-kit-add-feature-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function happyPathDeps(overrides?: Partial<SpecKitDeps>): SpecKitDeps {
    const phasesRun: string[] = [];
    return {
      runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
        phasesRun.push(phase);
        return { exitCode: 0 };
      },
      analyzeHasIssues: async (): Promise<boolean> => false,
      registerProject: async (_name: string, _dir: string): Promise<string> => 'should-not-be-called',
      launchTaskRun: async (_projectId: string): Promise<void> => {},
      createSessionId: (() => {
        let c = 0;
        return () => `session-${++c}`;
      })(),
      phasesRun,
      ...overrides,
    };
  }

  describe('accepts existing project directory (no directory creation)', () => {
    it('should use the provided project directory without creating a new one', async () => {
      const existingDir = join(tmpDir, 'my-existing-project');
      mkdirSync(existingDir, { recursive: true });

      // Record the directory listing before the workflow
      const parentDir = tmpDir;
      const entriesBefore = new Set(readdirSync(parentDir));

      const deps = happyPathDeps();
      await startAddFeatureWorkflow({
        projectId: 'proj-123',
        projectDir: existingDir,
        description: 'Add OAuth2 authentication',
        dataDir,
        deps,
      });

      // No new directories should have been created under the parent
      const entriesAfter = new Set(readdirSync(parentDir));
      // Only data/ was already there from beforeEach, and the existing project
      assert.deepEqual(entriesAfter, entriesBefore, 'no new directories should be created');
    });

    it('should work with an existing project directory that already has files', async () => {
      const existingDir = join(tmpDir, 'project-with-files');
      mkdirSync(existingDir, { recursive: true });
      // Simulate existing project files
      mkdirSync(join(existingDir, 'src'), { recursive: true });

      const deps = happyPathDeps();
      const result = await startAddFeatureWorkflow({
        projectId: 'proj-456',
        projectDir: existingDir,
        description: 'New feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      // Existing directory structure should be preserved
      assert.ok(existsSync(join(existingDir, 'src')));
    });
  });

  describe('passes project dir to each phase agent session', () => {
    it('should pass the existing project directory to every phase', async () => {
      const existingDir = join(tmpDir, 'dir-check-project');
      mkdirSync(existingDir, { recursive: true });

      const dirsPerPhase: Array<{ phase: string; dir: string }> = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          dirsPerPhase.push({ phase, dir: projectDir });
          return { exitCode: 0 };
        },
      });

      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      // All 5 phases should receive the same existing project directory
      assert.equal(dirsPerPhase.length, 5);
      for (const entry of dirsPerPhase) {
        assert.equal(entry.dir, existingDir, `phase '${entry.phase}' should receive existing project dir`);
      }
    });

    it('should NOT pass a newly created directory — only the provided one', async () => {
      const existingDir = join(tmpDir, 'no-new-dir-project');
      mkdirSync(existingDir, { recursive: true });

      const dirsUsed: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (_phase: string, projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          dirsUsed.push(projectDir);
          return { exitCode: 0 };
        },
      });

      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      // Every directory used should be exactly the provided one
      for (const dir of dirsUsed) {
        assert.equal(dir, existingDir);
        assert.ok(!dir.includes('AGENT_RUNNER_PROJECTS_DIR'), 'should not use projects dir path');
      }
    });
  });

  describe('phase sequencing (specify → clarify → plan → tasks → analyze)', () => {
    it('should run phases in the correct order', async () => {
      const existingDir = join(tmpDir, 'seq-project');
      mkdirSync(existingDir, { recursive: true });

      const deps = happyPathDeps();
      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.deepEqual(deps.phasesRun, ['specify', 'clarify', 'plan', 'tasks', 'analyze']);
    });

    it('should use the same phase sequence as SPEC_KIT_PHASES constant', async () => {
      const existingDir = join(tmpDir, 'const-project');
      mkdirSync(existingDir, { recursive: true });

      const deps = happyPathDeps();
      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.deepEqual(
        deps.phasesRun,
        [...SPEC_KIT_PHASES],
        'phases run should match SPEC_KIT_PHASES constant'
      );
    });

    it('should stop on first phase failure without running subsequent phases', async () => {
      const existingDir = join(tmpDir, 'stop-project');
      mkdirSync(existingDir, { recursive: true });

      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          if (phase === 'clarify') return { exitCode: 1 };
          return { exitCode: 0 };
        },
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(result.failedPhase, 'clarify');
      assert.deepEqual(result.completedPhases, ['specify']);
      assert.deepEqual(phasesRun, ['specify', 'clarify']);
    });

    it('should create a unique session ID for each phase', async () => {
      const existingDir = join(tmpDir, 'session-id-project');
      mkdirSync(existingDir, { recursive: true });

      const sessionIds: string[] = [];
      let counter = 0;
      const deps = happyPathDeps({
        createSessionId: () => `add-feature-session-${++counter}`,
        runPhase: async (_phase: string, _projectDir: string, sessionId: string): Promise<PhaseResult> => {
          sessionIds.push(sessionId);
          return { exitCode: 0 };
        },
      });

      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      const uniqueIds = new Set(sessionIds);
      assert.equal(uniqueIds.size, sessionIds.length, 'each phase must get a unique session ID');
      assert.ok(sessionIds.length >= 5);
    });
  });

  describe('analyze loop cap at 5 iterations with notification on cap reached', () => {
    it('should cap the analyze loop at exactly 5 iterations', async () => {
      const existingDir = join(tmpDir, 'cap5-project');
      mkdirSync(existingDir, { recursive: true });

      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => true, // always issues
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'analyze-cap-reached');
      assert.equal(result.analyzeIterations, 5);
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 5, 'should run analyze exactly 5 times');
    });

    it('should return analyze-cap-reached outcome (enabling caller to notify user)', async () => {
      const existingDir = join(tmpDir, 'cap-outcome-project');
      mkdirSync(existingDir, { recursive: true });

      const deps = happyPathDeps({
        analyzeHasIssues: async (): Promise<boolean> => true,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      // Caller can detect this outcome to send user notification
      assert.equal(result.outcome, 'analyze-cap-reached');
      assert.equal(result.analyzeIterations, 5);
      // completedPhases should include pre-analyze phases + 5 analyze runs
      assert.ok(result.completedPhases!.includes('specify'));
      assert.ok(result.completedPhases!.includes('clarify'));
      assert.ok(result.completedPhases!.includes('plan'));
      assert.ok(result.completedPhases!.includes('tasks'));
      const analyzeCount = result.completedPhases!.filter(p => p === 'analyze').length;
      assert.equal(analyzeCount, 5);
    });

    it('should stop looping and return completed when analyze finds no issues', async () => {
      const existingDir = join(tmpDir, 'clean-analyze-project');
      mkdirSync(existingDir, { recursive: true });

      let analyzeCallCount = 0;
      const deps = happyPathDeps({
        analyzeHasIssues: async (): Promise<boolean> => {
          analyzeCallCount++;
          return analyzeCallCount < 3; // issues on 1st/2nd, clean on 3rd
        },
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(result.analyzeIterations, 3);
    });

    it('should return failed if analyze process itself crashes during loop', async () => {
      const existingDir = join(tmpDir, 'analyze-crash-project');
      mkdirSync(existingDir, { recursive: true });

      let analyzeCallCount = 0;
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          if (phase === 'analyze') {
            analyzeCallCount++;
            if (analyzeCallCount === 3) return { exitCode: 1 }; // crash on 3rd analyze
          }
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => true,
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(result.failedPhase, 'analyze');
      assert.equal(result.analyzeIterations, 3);
    });
  });

  describe('run-tasks.sh launch against existing project dir after approval', () => {
    it('should launch task run with the existing project ID on success', async () => {
      const existingDir = join(tmpDir, 'launch-project');
      mkdirSync(existingDir, { recursive: true });

      let launchedProjectId: string | null = null;
      const deps = happyPathDeps({
        launchTaskRun: async (projectId: string): Promise<void> => {
          launchedProjectId = projectId;
        },
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'existing-proj-42',
        projectDir: existingDir,
        description: 'Add search feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(result.projectId, 'existing-proj-42');
      assert.equal(launchedProjectId, 'existing-proj-42', 'should launch task run with existing project ID');
    });

    it('should NOT register the project (already registered)', async () => {
      const existingDir = join(tmpDir, 'no-register-project');
      mkdirSync(existingDir, { recursive: true });

      let registerCalled = false;
      const deps = happyPathDeps({
        registerProject: async (): Promise<string> => {
          registerCalled = true;
          return 'new-id';
        },
      });

      await startAddFeatureWorkflow({
        projectId: 'existing-proj-99',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(registerCalled, false, 'should NOT call registerProject for add-feature');
    });

    it('should NOT launch task run when workflow fails', async () => {
      const existingDir = join(tmpDir, 'no-launch-project');
      mkdirSync(existingDir, { recursive: true });

      let launched = false;
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          if (phase === 'specify') return { exitCode: 1 };
          return { exitCode: 0 };
        },
        launchTaskRun: async (): Promise<void> => {
          launched = true;
        },
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(launched, false, 'should NOT launch task run on workflow failure');
    });

    it('should NOT launch task run when analyze cap is reached', async () => {
      const existingDir = join(tmpDir, 'no-launch-cap-project');
      mkdirSync(existingDir, { recursive: true });

      let launched = false;
      const deps = happyPathDeps({
        analyzeHasIssues: async (): Promise<boolean> => true,
        launchTaskRun: async (): Promise<void> => {
          launched = true;
        },
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'analyze-cap-reached');
      assert.equal(launched, false, 'should NOT launch task run when analyze cap reached');
    });
  });
});
