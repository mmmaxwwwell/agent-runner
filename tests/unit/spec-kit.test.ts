import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The module under test — will be implemented in T057
import {
  startNewProjectWorkflow,
  startAddFeatureWorkflow,
  SPEC_KIT_PHASES,
  type SpecKitDeps,
  type PhaseResult,
  type WorkflowResult,
} from '../../src/services/spec-kit.ts';

describe('spec-kit workflow orchestrator', () => {
  let tmpDir: string;
  let projectsDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spec-kit-test-'));
    projectsDir = join(tmpDir, 'projects');
    dataDir = join(tmpDir, 'data');
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Creates mock deps where every phase exits with code 0 and analyze reports no issues. */
  function happyPathDeps(overrides?: Partial<SpecKitDeps>): SpecKitDeps {
    const phasesRun: string[] = [];
    return {
      runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
        phasesRun.push(phase);
        return { exitCode: 0 };
      },
      analyzeHasIssues: async (_projectDir: string): Promise<boolean> => {
        return false;
      },
      registerProject: async (name: string, dir: string): Promise<string> => {
        return 'registered-project-id';
      },
      launchTaskRun: async (_projectId: string): Promise<void> => {},
      createSessionId: () => 'mock-session-id',
      phasesRun,
      ...overrides,
    };
  }

  describe('SPEC_KIT_PHASES', () => {
    it('should define the correct phase sequence', () => {
      assert.deepEqual(SPEC_KIT_PHASES, ['specify', 'clarify', 'plan', 'tasks', 'analyze']);
    });
  });

  describe('startNewProjectWorkflow', () => {
    it('should create project directory under projectsDir/<repo-name>', async () => {
      const deps = happyPathDeps();
      await startNewProjectWorkflow({
        repoName: 'my-new-project',
        description: 'A cool project idea',
        projectsDir,
        dataDir,
        deps,
      });

      const projectDir = join(projectsDir, 'my-new-project');
      assert.ok(existsSync(projectDir), 'project directory should be created');
    });

    it('should run all phases in order: specify → clarify → plan → tasks → analyze', async () => {
      const deps = happyPathDeps();
      await startNewProjectWorkflow({
        repoName: 'test-project',
        description: 'test idea',
        projectsDir,
        dataDir,
        deps,
      });

      assert.deepEqual(deps.phasesRun, ['specify', 'clarify', 'plan', 'tasks', 'analyze']);
    });

    it('should pass the project directory to each phase', async () => {
      const dirsUsed: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (_phase: string, projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          dirsUsed.push(projectDir);
          return { exitCode: 0 };
        },
      });

      await startNewProjectWorkflow({
        repoName: 'dir-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      const expectedDir = join(projectsDir, 'dir-test');
      assert.equal(dirsUsed.length, 5);
      for (const dir of dirsUsed) {
        assert.equal(dir, expectedDir);
      }
    });

    it('should stop and return failed when a phase exits with non-zero code', async () => {
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          // clarify phase fails
          if (phase === 'clarify') {
            return { exitCode: 1 };
          }
          return { exitCode: 0 };
        },
        phasesRun,
      });

      const result = await startNewProjectWorkflow({
        repoName: 'fail-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(result.failedPhase, 'clarify');
      // Should have run specify and clarify, but NOT plan/tasks/analyze
      assert.deepEqual(phasesRun, ['specify', 'clarify']);
    });

    it('should not register project or launch task run when a phase fails', async () => {
      let registered = false;
      let launched = false;
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          if (phase === 'plan') return { exitCode: 1 };
          return { exitCode: 0 };
        },
        registerProject: async (): Promise<string> => {
          registered = true;
          return 'id';
        },
        launchTaskRun: async (): Promise<void> => {
          launched = true;
        },
      });

      await startNewProjectWorkflow({
        repoName: 'no-register-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(registered, false, 'should not register project on failure');
      assert.equal(launched, false, 'should not launch task run on failure');
    });

    it('should auto-register the project after all phases complete successfully', async () => {
      let registeredName: string | null = null;
      let registeredDir: string | null = null;
      const deps = happyPathDeps({
        registerProject: async (name: string, dir: string): Promise<string> => {
          registeredName = name;
          registeredDir = dir;
          return 'new-project-id';
        },
      });

      const result = await startNewProjectWorkflow({
        repoName: 'register-test',
        description: 'a project',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(registeredName, 'register-test');
      assert.equal(registeredDir, join(projectsDir, 'register-test'));
      assert.equal(result.projectId, 'new-project-id');
    });

    it('should launch run-tasks.sh after successful workflow and registration', async () => {
      let launchedProjectId: string | null = null;
      const deps = happyPathDeps({
        registerProject: async (): Promise<string> => 'proj-123',
        launchTaskRun: async (projectId: string): Promise<void> => {
          launchedProjectId = projectId;
        },
      });

      const result = await startNewProjectWorkflow({
        repoName: 'launch-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(launchedProjectId, 'proj-123');
    });

    it('should return completed result with all phase names on success', async () => {
      const deps = happyPathDeps();
      const result = await startNewProjectWorkflow({
        repoName: 'result-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.deepEqual(result.completedPhases, ['specify', 'clarify', 'plan', 'tasks', 'analyze']);
    });
  });

  describe('analyze-remediate loop', () => {
    it('should re-run analyze when issues are found (loop until clean)', async () => {
      let analyzeCallCount = 0;
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => {
          analyzeCallCount++;
          // Issues found on first 2 calls, clean on 3rd
          return analyzeCallCount < 3;
        },
        phasesRun,
      });

      const result = await startNewProjectWorkflow({
        repoName: 'analyze-loop-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      // Should have: specify, clarify, plan, tasks, analyze (1st), analyze (2nd), analyze (3rd - clean)
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 3, 'analyze should run 3 times (2 with issues + 1 clean)');
      assert.equal(result.analyzeIterations, 3);
    });

    it('should cap the analyze loop at 5 iterations', async () => {
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => {
          return true; // Always has issues — should be capped
        },
        phasesRun,
      });

      const result = await startNewProjectWorkflow({
        repoName: 'cap-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'analyze-cap-reached');
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 5, 'analyze should run exactly 5 times (max iterations)');
      assert.equal(result.analyzeIterations, 5);
    });

    it('should not re-run analyze when no issues found on first pass', async () => {
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => false,
        phasesRun,
      });

      const result = await startNewProjectWorkflow({
        repoName: 'no-loop-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 1, 'analyze should run exactly once');
      assert.equal(result.analyzeIterations, 1);
    });

    it('should stop the analyze loop and return failed if analyze process exits non-zero', async () => {
      let analyzeCallCount = 0;
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string, _projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          if (phase === 'analyze') {
            analyzeCallCount++;
            if (analyzeCallCount === 2) {
              return { exitCode: 1 }; // Crash on 2nd analyze run
            }
          }
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => true, // Always issues
        phasesRun,
      });

      const result = await startNewProjectWorkflow({
        repoName: 'analyze-crash-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(result.failedPhase, 'analyze');
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 2);
    });
  });

  describe('startAddFeatureWorkflow', () => {
    it('should NOT create a new directory — uses existing project directory', async () => {
      const existingProjectDir = join(tmpDir, 'existing-project');
      mkdirSync(existingProjectDir, { recursive: true });
      const projectsBefore = existsSync(projectsDir) ? [] : [];

      const deps = happyPathDeps();
      await startAddFeatureWorkflow({
        projectId: 'existing-proj-id',
        projectDir: existingProjectDir,
        description: 'Add OAuth support',
        dataDir,
        deps,
      });

      // Should NOT create any new directories under projectsDir
      // The existing project directory should be used as-is
      assert.ok(existsSync(existingProjectDir));
    });

    it('should pass existing project directory to each phase', async () => {
      const existingProjectDir = join(tmpDir, 'my-existing-project');
      mkdirSync(existingProjectDir, { recursive: true });

      const dirsUsed: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (_phase: string, projectDir: string, _sessionId: string): Promise<PhaseResult> => {
          dirsUsed.push(projectDir);
          return { exitCode: 0 };
        },
      });

      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingProjectDir,
        description: 'new feature',
        dataDir,
        deps,
      });

      assert.equal(dirsUsed.length, 5);
      for (const dir of dirsUsed) {
        assert.equal(dir, existingProjectDir);
      }
    });

    it('should run all phases in order: specify → clarify → plan → tasks → analyze', async () => {
      const existingProjectDir = join(tmpDir, 'phase-order-project');
      mkdirSync(existingProjectDir, { recursive: true });

      const deps = happyPathDeps();
      await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingProjectDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.deepEqual(deps.phasesRun, ['specify', 'clarify', 'plan', 'tasks', 'analyze']);
    });

    it('should stop on non-zero exit code, same as new project workflow', async () => {
      const existingProjectDir = join(tmpDir, 'fail-project');
      mkdirSync(existingProjectDir, { recursive: true });

      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          if (phase === 'tasks') return { exitCode: 1 };
          return { exitCode: 0 };
        },
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingProjectDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'failed');
      assert.equal(result.failedPhase, 'tasks');
      assert.deepEqual(phasesRun, ['specify', 'clarify', 'plan', 'tasks']);
    });

    it('should NOT register project (already registered) — only launch task run', async () => {
      const existingProjectDir = join(tmpDir, 'no-register-project');
      mkdirSync(existingProjectDir, { recursive: true });

      let registered = false;
      let launchedProjectId: string | null = null;
      const deps = happyPathDeps({
        registerProject: async (): Promise<string> => {
          registered = true;
          return 'id';
        },
        launchTaskRun: async (projectId: string): Promise<void> => {
          launchedProjectId = projectId;
        },
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'existing-proj-id',
        projectDir: existingProjectDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(registered, false, 'should NOT register project for add-feature');
      assert.equal(launchedProjectId, 'existing-proj-id', 'should launch task run with existing project ID');
    });

    it('should support the analyze-remediate loop same as new project', async () => {
      const existingProjectDir = join(tmpDir, 'analyze-project');
      mkdirSync(existingProjectDir, { recursive: true });

      let analyzeCallCount = 0;
      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => {
          analyzeCallCount++;
          return analyzeCallCount < 2; // Issues on 1st, clean on 2nd
        },
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingProjectDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 2);
      assert.equal(result.analyzeIterations, 2);
    });

    it('should cap analyze loop at 5 iterations for add-feature too', async () => {
      const existingProjectDir = join(tmpDir, 'cap-project');
      mkdirSync(existingProjectDir, { recursive: true });

      const phasesRun: string[] = [];
      const deps = happyPathDeps({
        runPhase: async (phase: string): Promise<PhaseResult> => {
          phasesRun.push(phase);
          return { exitCode: 0 };
        },
        analyzeHasIssues: async (): Promise<boolean> => true,
        phasesRun,
      });

      const result = await startAddFeatureWorkflow({
        projectId: 'proj-1',
        projectDir: existingProjectDir,
        description: 'feature',
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'analyze-cap-reached');
      const analyzeRuns = phasesRun.filter(p => p === 'analyze');
      assert.equal(analyzeRuns.length, 5);
    });
  });

  describe('phase completion detection', () => {
    it('should treat exit code 0 as phase success and advance', async () => {
      const deps = happyPathDeps();
      const result = await startNewProjectWorkflow({
        repoName: 'exit0-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      assert.equal(result.outcome, 'completed');
      assert.equal(deps.phasesRun!.length, 5);
    });

    it('should treat any non-zero exit code as phase failure', async () => {
      for (const exitCode of [1, 2, 127, 255]) {
        const phasesRun: string[] = [];
        const deps = happyPathDeps({
          runPhase: async (phase: string): Promise<PhaseResult> => {
            phasesRun.push(phase);
            if (phase === 'specify') return { exitCode };
            return { exitCode: 0 };
          },
          phasesRun,
        });

        const result = await startNewProjectWorkflow({
          repoName: `exit${exitCode}-test`,
          description: 'test',
          projectsDir,
          dataDir,
          deps,
        });

        assert.equal(result.outcome, 'failed', `exit code ${exitCode} should be treated as failure`);
        assert.deepEqual(phasesRun, ['specify'], `should stop after failed specify (exit code ${exitCode})`);
      }
    });
  });

  describe('session ID generation', () => {
    it('should create a unique session ID for each phase', async () => {
      const sessionIds: string[] = [];
      let counter = 0;
      const deps = happyPathDeps({
        createSessionId: () => `session-${++counter}`,
        runPhase: async (_phase: string, _projectDir: string, sessionId: string): Promise<PhaseResult> => {
          sessionIds.push(sessionId);
          return { exitCode: 0 };
        },
      });

      await startNewProjectWorkflow({
        repoName: 'session-id-test',
        description: 'test',
        projectsDir,
        dataDir,
        deps,
      });

      // Each phase should get a different session ID
      const uniqueIds = new Set(sessionIds);
      assert.equal(uniqueIds.size, sessionIds.length, 'each phase should have a unique session ID');
      assert.ok(sessionIds.length >= 5, 'should have at least 5 session IDs (one per phase)');
    });
  });
});
