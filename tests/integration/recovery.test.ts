import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resumeAll, type RecoveryResult } from '../../src/services/recovery.ts';
import { getSession, type Session } from '../../src/models/session.ts';
import { readLog } from '../../src/services/session-logger.ts';

describe('crash recovery (integration)', () => {
  let tmpDir: string;
  let dataDir: string;
  let sessionsDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recovery-test-'));
    dataDir = join(tmpDir, 'data');
    sessionsDir = join(dataDir, 'sessions');
    projectDir = join(tmpDir, 'project');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Create a valid task file so the project is valid
    writeFileSync(join(projectDir, 'tasks.md'), `## Phase 1: Setup

- [ ] 1.1 First task
- [ ] 1.2 Second task
`);

    // Register a project in projects.json
    const project = {
      id: 'test-project-1',
      name: 'Test Project',
      dir: projectDir,
      taskFile: 'tasks.md',
      promptFile: '',
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([project], null, 2) + '\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a fake session directory with meta.json (simulating a crash).
   */
  function createSessionOnDisk(sessionId: string, meta: Partial<Session>): void {
    const sessionDir = join(sessionsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const fullMeta: Session = {
      id: sessionId,
      projectId: 'test-project-1',
      type: 'task-run',
      state: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      pid: 99999, // Fake PID — process is dead after crash
      lastTaskId: null,
      question: null,
      exitCode: null,
      ...meta,
    };
    writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(fullMeta, null, 2) + '\n');
    // Create an empty output.jsonl so the logger can append
    writeFileSync(join(sessionDir, 'output.jsonl'), '');
  }

  describe('running task-run session recovery', () => {
    it('should resume a running task-run session after simulated crash', async () => {
      // Simulate: server crashed while a task-run session was running.
      // The session's meta.json has state "running".
      // On recovery, resumeAll should re-spawn the task loop.
      //
      // Because buildCommand calls sandbox.isAvailable() and that may fail in test,
      // we set ALLOW_UNSANDBOXED=true so the recovery path can build a command.
      const origAllow = process.env['ALLOW_UNSANDBOXED'];
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      createSessionOnDisk('session-running-1', {
        state: 'running',
        type: 'task-run',
      });

      try {
        const result = await resumeAll(dataDir);

        assert.equal(result.resumed, 1, 'Should resume 1 session');
        assert.equal(result.waitingRestored, 0);
        assert.equal(result.failed, 0);

        // Give the task loop a moment to start (it runs in the background)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check that the session has a system log entry about resuming
        const logPath = join(sessionsDir, 'session-running-1', 'output.jsonl');
        const entries = await readLog(logPath);
        const systemEntries = entries.filter(e => e.stream === 'system');
        const hasResumeEntry = systemEntries.some(e => e.content.includes('Resuming session after server restart'));
        assert.ok(hasResumeEntry, 'Should have a system log entry about resuming');
      } finally {
        process.env['ALLOW_UNSANDBOXED'] = origAllow;
      }
    });
  });

  describe('waiting-for-input session recovery', () => {
    it('should restore waiting-for-input sessions without re-spawning', async () => {
      createSessionOnDisk('session-waiting-1', {
        state: 'waiting-for-input',
        type: 'task-run',
        question: 'What API key should I use?',
        lastTaskId: '1.1',
        pid: null,
      });

      const result = await resumeAll(dataDir);

      assert.equal(result.waitingRestored, 1, 'Should restore 1 waiting session');
      assert.equal(result.resumed, 0);
      assert.equal(result.failed, 0);

      // Session should remain in waiting-for-input state
      const session = getSession(dataDir, 'session-waiting-1');
      assert.ok(session);
      assert.equal(session.state, 'waiting-for-input');
      assert.equal(session.question, 'What API key should I use?');
    });
  });

  describe('interview session recovery', () => {
    it('should mark running interview sessions as failed (context lost)', async () => {
      createSessionOnDisk('session-interview-1', {
        state: 'running',
        type: 'interview',
      });

      const result = await resumeAll(dataDir);

      assert.equal(result.failed, 1, 'Should fail 1 interview session');
      assert.equal(result.resumed, 0);
      assert.equal(result.waitingRestored, 0);

      // Session should be marked failed
      const session = getSession(dataDir, 'session-interview-1');
      assert.ok(session);
      assert.equal(session.state, 'failed');
      assert.equal(session.exitCode, -1);
      assert.ok(session.endedAt, 'Should have an endedAt timestamp');

      // Should have a log entry explaining why
      const logPath = join(sessionsDir, 'session-interview-1', 'output.jsonl');
      const entries = await readLog(logPath);
      const hasContextLostEntry = entries.some(e =>
        e.stream === 'system' && e.content.includes('context lost')
      );
      assert.ok(hasContextLostEntry, 'Should log that interview context was lost');
    });
  });

  describe('orphaned session (project removed)', () => {
    it('should mark running session as failed when its project no longer exists', async () => {
      createSessionOnDisk('session-orphan-1', {
        state: 'running',
        type: 'task-run',
        projectId: 'nonexistent-project',
      });

      const result = await resumeAll(dataDir);

      assert.equal(result.failed, 1, 'Should fail 1 orphaned session');
      assert.equal(result.resumed, 0);

      const session = getSession(dataDir, 'session-orphan-1');
      assert.ok(session);
      assert.equal(session.state, 'failed');
      assert.equal(session.exitCode, -1);
    });
  });

  describe('completed and failed sessions (no action)', () => {
    it('should skip sessions that are already completed or failed', async () => {
      createSessionOnDisk('session-completed', {
        state: 'completed',
        exitCode: 0,
        endedAt: new Date().toISOString(),
      });

      createSessionOnDisk('session-failed', {
        state: 'failed',
        exitCode: 1,
        endedAt: new Date().toISOString(),
      });

      const result = await resumeAll(dataDir);

      assert.equal(result.resumed, 0);
      assert.equal(result.waitingRestored, 0);
      assert.equal(result.failed, 0);

      // Sessions should remain unchanged
      const completed = getSession(dataDir, 'session-completed');
      assert.equal(completed!.state, 'completed');

      const failed = getSession(dataDir, 'session-failed');
      assert.equal(failed!.state, 'failed');
    });
  });

  describe('mixed session states', () => {
    it('should handle multiple sessions with different states in a single recovery pass', async () => {
      const origAllow = process.env['ALLOW_UNSANDBOXED'];
      process.env['ALLOW_UNSANDBOXED'] = 'true';

      // 1. Running task-run → should resume
      createSessionOnDisk('session-mix-running', {
        state: 'running',
        type: 'task-run',
      });

      // 2. Waiting-for-input → should restore
      createSessionOnDisk('session-mix-waiting', {
        state: 'waiting-for-input',
        type: 'task-run',
        question: 'Need help',
        pid: null,
      });

      // 3. Running interview → should fail
      createSessionOnDisk('session-mix-interview', {
        state: 'running',
        type: 'interview',
      });

      // 4. Completed → should skip
      createSessionOnDisk('session-mix-completed', {
        state: 'completed',
        exitCode: 0,
        endedAt: new Date().toISOString(),
      });

      try {
        const result = await resumeAll(dataDir);

        assert.equal(result.resumed, 1, 'Should resume 1 task-run');
        assert.equal(result.waitingRestored, 1, 'Should restore 1 waiting session');
        assert.equal(result.failed, 1, 'Should fail 1 interview session');

        // Give resumed task loop a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify interview was failed
        const interview = getSession(dataDir, 'session-mix-interview');
        assert.equal(interview!.state, 'failed');

        // Verify waiting session preserved
        const waiting = getSession(dataDir, 'session-mix-waiting');
        assert.equal(waiting!.state, 'waiting-for-input');
        assert.equal(waiting!.question, 'Need help');

        // Verify completed session unchanged
        const completed = getSession(dataDir, 'session-mix-completed');
        assert.equal(completed!.state, 'completed');
      } finally {
        process.env['ALLOW_UNSANDBOXED'] = origAllow;
      }
    });
  });

  describe('no sessions directory', () => {
    it('should handle missing sessions directory gracefully', async () => {
      // Remove the sessions directory entirely
      rmSync(sessionsDir, { recursive: true, force: true });

      const result = await resumeAll(dataDir);

      assert.equal(result.resumed, 0);
      assert.equal(result.waitingRestored, 0);
      assert.equal(result.failed, 0);
    });
  });

  describe('empty sessions directory', () => {
    it('should handle empty sessions directory gracefully', async () => {
      // Sessions directory exists but is empty
      const result = await resumeAll(dataDir);

      assert.equal(result.resumed, 0);
      assert.equal(result.waitingRestored, 0);
      assert.equal(result.failed, 0);
    });
  });
});
