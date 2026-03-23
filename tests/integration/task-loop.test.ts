import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Module under test — will be implemented in T028
import {
  startTaskLoop,
  type TaskLoopResult,
} from '../../src/services/process-manager.ts';

// Dependencies (implemented in earlier tasks or to be implemented in T024-T026)
import {
  createSessionLogger,
  readLog,
} from '../../src/services/session-logger.ts';
import {
  createSession,
  getSession,
  transitionState,
} from '../../src/models/session.ts';
import { parseTasks, parseTaskSummary } from '../../src/services/task-parser.ts';

describe('task-run auto-loop (integration)', () => {
  let tmpDir: string;
  let dataDir: string;
  let sessionsDir: string;
  let projectDir: string;
  let taskFilePath: string;
  const projectId = 'test-loop-project';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'task-loop-test-'));
    dataDir = join(tmpDir, 'data');
    sessionsDir = join(dataDir, 'sessions');
    projectDir = join(tmpDir, 'project');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    taskFilePath = join(projectDir, 'tasks.md');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTaskFile(content: string): void {
    writeFileSync(taskFilePath, content);
  }

  /**
   * Creates a bash script that simulates an agent completing a task by
   * replacing `- [ ] <taskId>` with `- [x] <taskId>` in the task file.
   */
  function makeCompleteTaskScript(taskId: string): string[] {
    return [
      '-c',
      `sed -i 's/- \\[ \\] ${taskId}/- [x] ${taskId}/' "${taskFilePath}" && echo "Completed task ${taskId}"`,
    ];
  }

  /**
   * Creates a bash script that simulates an agent marking a task as blocked
   * by replacing `- [ ] <taskId>` with `- [?] <taskId>` and appending
   * a blocked reason.
   */
  function makeBlockTaskScript(taskId: string, question: string): string[] {
    return [
      '-c',
      `sed -i 's/- \\[ \\] ${taskId} \\(.*\\)/- [?] ${taskId} \\1 — Blocked: ${question}/' "${taskFilePath}" && echo "Blocked on task ${taskId}"`,
    ];
  }

  describe('re-parse after run and spawn next', () => {
    it('should re-parse the task file after a process exits and detect remaining unchecked tasks', async () => {
      // Set up a task file with 2 unchecked tasks.
      // The "agent" script will complete task 1.1 on first run.
      // The loop should detect 1.2 still unchecked and spawn again.
      // The second "agent" script completes task 1.2.
      // After that, all tasks are done and the loop should stop.
      writeTaskFile(`## Phase 1: Setup

- [x] 1.1 Already done
- [ ] 1.2 Second task
- [ ] 1.3 Third task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Use a command that completes one task per invocation.
      // The auto-loop should call the command multiple times.
      // We use a script that marks the first unchecked task as done.
      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          # Find first unchecked task and mark it done
          TASK_ID=$(grep -oP '(?<=- \\[ \\] )\\d+(\\.\\d+)*' "${taskFilePath}" | head -1)
          if [ -n "$TASK_ID" ]; then
            sed -i "s/- \\[ \\] $TASK_ID/- [x] $TASK_ID/" "${taskFilePath}"
            echo "Completed task $TASK_ID"
          fi
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      // After the loop, all tasks should be marked done
      const summary = parseTaskSummary(taskFilePath);
      assert.equal(summary.remaining, 0, 'No unchecked tasks should remain');
      assert.equal(summary.completed, 3, 'All three tasks should be completed');

      // The result should indicate completion
      assert.equal(result.outcome, 'completed', 'Loop should end with completed outcome');
    });

    it('should spawn multiple processes for multiple unchecked tasks', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          TASK_ID=$(grep -oP '(?<=- \\[ \\] )\\d+(\\.\\d+)*' "${taskFilePath}" | head -1)
          if [ -n "$TASK_ID" ]; then
            sed -i "s/- \\[ \\] $TASK_ID/- [x] $TASK_ID/" "${taskFilePath}"
            echo "Completed task $TASK_ID"
          fi
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      // Verify at least 2 spawns happened (one per unchecked task)
      assert.ok(result.spawnCount >= 2, `Should have spawned at least 2 processes, got ${result.spawnCount}`);

      const summary = parseTaskSummary(taskFilePath);
      assert.equal(summary.remaining, 0);
    });
  });

  describe('stop on blocked task [?]', () => {
    it('should stop looping when a task is marked [?] and transition to waiting-for-input', async () => {
      writeTaskFile(`## Phase 1: Setup

- [x] 1.1 Already done
- [ ] 1.2 Ambiguous task
- [ ] 1.3 Another task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Agent marks task 1.2 as blocked instead of completing it
      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          sed -i 's/- \\[ \\] 1.2 Ambiguous task/- [?] 1.2 Ambiguous task — Blocked: What does this mean?/' "${taskFilePath}"
          echo "Blocked on task 1.2"
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'waiting-for-input', 'Loop should end with waiting-for-input outcome');
      assert.ok(result.question, 'Should have a question from the blocked task');
      assert.ok(
        result.question!.includes('What does this mean?'),
        `Question should contain the blocked reason, got: ${result.question}`
      );

      // Session should be transitioned to waiting-for-input
      const updatedSession = getSession(dataDir, session.id);
      assert.equal(updatedSession!.state, 'waiting-for-input');
      assert.ok(updatedSession!.question);
    });

    it('should detect [?] even when other unchecked tasks remain', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
- [ ] 1.3 Third task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Agent completes task 1.1 but marks 1.2 as blocked
      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          # Check if 1.1 is still unchecked — complete it first
          if grep -q '\\- \\[ \\] 1.1' "${taskFilePath}"; then
            sed -i 's/- \\[ \\] 1.1/- [x] 1.1/' "${taskFilePath}"
            echo "Completed task 1.1"
          else
            # On second run, block on 1.2
            sed -i 's/- \\[ \\] 1.2 Second task/- [?] 1.2 Second task — Blocked: Need clarification/' "${taskFilePath}"
            echo "Blocked on task 1.2"
          fi
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'waiting-for-input');
      // Task 1.3 is still unchecked, but we should stop due to [?]
      const summary = parseTaskSummary(taskFilePath);
      assert.equal(summary.blocked, 1);
      assert.equal(summary.remaining, 1, 'Task 1.3 should still be unchecked');
    });
  });

  describe('stop on all tasks complete', () => {
    it('should mark session completed when all tasks are checked or skipped', async () => {
      writeTaskFile(`## Phase 1: Setup

- [x] 1.1 Already done
- [~] 1.2 Skipped task — Skipped: not needed
- [ ] 1.3 Last remaining task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          sed -i 's/- \\[ \\] 1.3/- [x] 1.3/' "${taskFilePath}"
          echo "Completed task 1.3"
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'completed', 'Loop should end with completed outcome');

      // Session should be transitioned to completed
      const updatedSession = getSession(dataDir, session.id);
      assert.equal(updatedSession!.state, 'completed');
      assert.ok(updatedSession!.endedAt, 'Should have endedAt timestamp');
    });

    it('should complete immediately when task file has no unchecked tasks', async () => {
      writeTaskFile(`## Phase 1: Setup

- [x] 1.1 Done
- [x] 1.2 Done
- [~] 1.3 Skipped — Skipped: not needed
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Command should not even be spawned since all tasks are already done
      const result = await startTaskLoop({
        command: 'echo',
        args: ['should not run'],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'completed');
      assert.equal(result.spawnCount, 0, 'Should not spawn any processes when all tasks done');
    });
  });

  describe('handle process crash (non-zero exit)', () => {
    it('should mark session as failed when process crashes', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 Some task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', 'echo "crashing..." && exit 1'],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'failed', 'Loop should end with failed outcome');

      // Session should be transitioned to failed
      const updatedSession = getSession(dataDir, session.id);
      assert.equal(updatedSession!.state, 'failed');
      assert.ok(updatedSession!.endedAt, 'Should have endedAt timestamp');
      assert.ok(updatedSession!.exitCode !== 0, 'Exit code should be non-zero');
    });

    it('should not retry after a crash', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 Some task
- [ ] 1.2 Another task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', 'exit 42'],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'failed');
      assert.equal(result.spawnCount, 1, 'Should only spawn once — no retry after crash');

      // Tasks should remain unchecked
      const summary = parseTaskSummary(taskFilePath);
      assert.equal(summary.remaining, 2, 'Tasks should still be unchecked after crash');
    });
  });

  describe('session log continuity across loop iterations', () => {
    it('should append to the same output log across multiple loop iterations', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          TASK_ID=$(grep -oP '(?<=- \\[ \\] )\\d+(\\.\\d+)*' "${taskFilePath}" | head -1)
          if [ -n "$TASK_ID" ]; then
            sed -i "s/- \\[ \\] $TASK_ID/- [x] $TASK_ID/" "${taskFilePath}"
            echo "Completed task $TASK_ID"
          fi
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      // Read the log and verify entries from multiple iterations
      const entries = await readLog(logPath);
      assert.ok(entries.length > 0, 'Should have log entries');

      // Verify sequence numbers are monotonically increasing across iterations
      for (let i = 1; i < entries.length; i++) {
        assert.ok(
          entries[i].seq > entries[i - 1].seq,
          `seq ${entries[i].seq} should be greater than ${entries[i - 1].seq}`
        );
      }

      // Should have output from both iterations
      const stdoutEntries = entries.filter(e => e.stream === 'stdout');
      const combined = stdoutEntries.map(e => e.content).join('');
      assert.ok(combined.includes('1.1'), 'Should have output referencing task 1.1');
      assert.ok(combined.includes('1.2'), 'Should have output referencing task 1.2');
    });
  });

  describe('edge cases', () => {
    it('should handle a task file that becomes empty mid-loop', async () => {
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 Only task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Agent completes the only remaining task
      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          sed -i 's/- \\[ \\] 1.1/- [x] 1.1/' "${taskFilePath}"
          echo "Done"
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'completed');
      assert.equal(result.spawnCount, 1);
    });

    it('should handle process that exits with 0 but does not modify task file', async () => {
      // If the process exits successfully but makes no progress,
      // the loop should still check and re-spawn (agent might have done something
      // else useful). However, to prevent infinite loops, this test verifies
      // that the loop eventually handles the situation.
      writeTaskFile(`## Phase 1: Setup

- [ ] 1.1 Stubborn task
`);

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Use a counter file to limit iterations — complete on second try
      const counterFile = join(tmpDir, 'counter');
      writeFileSync(counterFile, '0');

      const result = await startTaskLoop({
        command: 'bash',
        args: ['-c', `
          COUNT=$(cat "${counterFile}")
          COUNT=$((COUNT + 1))
          echo $COUNT > "${counterFile}"
          if [ $COUNT -ge 2 ]; then
            sed -i 's/- \\[ \\] 1.1/- [x] 1.1/' "${taskFilePath}"
            echo "Finally completed task 1.1"
          else
            echo "Did nothing useful"
          fi
        `],
        sessionId: session.id,
        projectId,
        taskFilePath,
        logger,
        dataDir,
      });

      await logger.close();

      assert.equal(result.outcome, 'completed');
      assert.ok(result.spawnCount >= 2, 'Should have spawned at least twice');
    });
  });
});
