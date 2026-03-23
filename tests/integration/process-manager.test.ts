import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Module under test — will be implemented in T027
import {
  spawnProcess,
  killProcess,
  type ProcessHandle,
  type ProcessEvent,
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

describe('process-manager (integration)', () => {
  let tmpDir: string;
  let dataDir: string;
  let sessionsDir: string;
  let projectDir: string;
  const projectId = 'test-project-id';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'process-manager-test-'));
    dataDir = join(tmpDir, 'data');
    sessionsDir = join(dataDir, 'sessions');
    projectDir = join(tmpDir, 'project');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('spawnProcess', () => {
    it('should spawn a process and return a ProcessHandle with pid', async () => {
      // Use a simple command that exits quickly
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'echo',
        args: ['hello world'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      assert.ok(handle, 'Should return a ProcessHandle');
      assert.ok(typeof handle.pid === 'number', 'Should have a numeric pid');
      assert.ok(handle.pid > 0, 'pid should be positive');

      // Wait for exit
      await handle.waitForExit();
      await logger.close();
    });

    it('should capture stdout from the spawned process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'echo',
        args: ['captured output'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      const stdoutEntries = entries.filter(e => e.stream === 'stdout');
      assert.ok(stdoutEntries.length > 0, 'Should have stdout entries');

      const combinedOutput = stdoutEntries.map(e => e.content).join('');
      assert.ok(
        combinedOutput.includes('captured output'),
        `stdout should contain 'captured output', got: ${combinedOutput}`
      );
    });

    it('should capture stderr from the spawned process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'echo "error output" >&2'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      const stderrEntries = entries.filter(e => e.stream === 'stderr');
      assert.ok(stderrEntries.length > 0, 'Should have stderr entries');

      const combinedStderr = stderrEntries.map(e => e.content).join('');
      assert.ok(
        combinedStderr.includes('error output'),
        `stderr should contain 'error output', got: ${combinedStderr}`
      );
    });

    it('should report exit code 0 for successful process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'true',
        args: [],
        sessionId: session.id,
        logger,
        dataDir,
      });

      const result = await handle.waitForExit();
      await logger.close();

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
    });

    it('should report non-zero exit code for failed process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'exit 42'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      const result = await handle.waitForExit();
      await logger.close();

      assert.equal(result.exitCode, 42, 'Exit code should be 42');
    });

    it('should emit events for process lifecycle', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const events: ProcessEvent[] = [];

      const handle = spawnProcess({
        command: 'echo',
        args: ['test'],
        sessionId: session.id,
        logger,
        dataDir,
        onEvent: (event) => { events.push(event); },
      });

      await handle.waitForExit();
      await logger.close();

      // Should have at least an 'exit' event
      const exitEvent = events.find(e => e.type === 'exit');
      assert.ok(exitEvent, 'Should emit an exit event');
      assert.equal(exitEvent!.exitCode, 0);
    });

    it('should handle process that produces both stdout and stderr', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'echo "out line"; echo "err line" >&2; echo "out line 2"'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      const streams = entries.map(e => e.stream);
      assert.ok(streams.includes('stdout'), 'Should have stdout entries');
      assert.ok(streams.includes('stderr'), 'Should have stderr entries');
    });

    it('should handle multiline output', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'echo "line1"; echo "line2"; echo "line3"'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      const stdoutEntries = entries.filter(e => e.stream === 'stdout');
      const combinedOutput = stdoutEntries.map(e => e.content).join('');
      assert.ok(combinedOutput.includes('line1'), 'Should contain line1');
      assert.ok(combinedOutput.includes('line2'), 'Should contain line2');
      assert.ok(combinedOutput.includes('line3'), 'Should contain line3');
    });

    it('should handle a process that runs for a short duration', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'sleep 0.1; echo "done"'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      const result = await handle.waitForExit();
      await logger.close();

      assert.equal(result.exitCode, 0);
      const entries = await readLog(logPath);
      const stdoutEntries = entries.filter(e => e.stream === 'stdout');
      const output = stdoutEntries.map(e => e.content).join('');
      assert.ok(output.includes('done'), 'Should capture output from delayed process');
    });
  });

  describe('killProcess', () => {
    it('should kill a running process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      // Start a long-running process
      const handle = spawnProcess({
        command: 'sleep',
        args: ['60'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      assert.ok(handle.pid > 0, 'Process should be running');

      // Kill it
      killProcess(handle);

      const result = await handle.waitForExit();
      await logger.close();

      // Killed processes typically exit with null code (signal kill)
      // or non-zero exit code
      assert.ok(
        result.exitCode !== 0 || result.signal !== null,
        'Killed process should have non-zero exit code or signal'
      );
    });

    it('should emit exit event after kill', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const events: ProcessEvent[] = [];

      const handle = spawnProcess({
        command: 'sleep',
        args: ['60'],
        sessionId: session.id,
        logger,
        dataDir,
        onEvent: (event) => { events.push(event); },
      });

      killProcess(handle);
      await handle.waitForExit();
      await logger.close();

      const exitEvent = events.find(e => e.type === 'exit');
      assert.ok(exitEvent, 'Should emit exit event after kill');
    });

    it('should not throw when killing an already-exited process', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'true',
        args: [],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();

      // Should not throw
      assert.doesNotThrow(() => killProcess(handle));
      await logger.close();
    });
  });

  describe('process output ordering', () => {
    it('should maintain sequence numbers across all logged entries', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'bash',
        args: ['-c', 'for i in $(seq 1 10); do echo "line $i"; done'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      // Verify monotonically increasing seq numbers
      for (let i = 1; i < entries.length; i++) {
        assert.ok(
          entries[i].seq > entries[i - 1].seq,
          `seq ${entries[i].seq} should be greater than ${entries[i - 1].seq}`
        );
      }
    });

    it('should include timestamps on all entries', async () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const before = Date.now();
      const handle = spawnProcess({
        command: 'echo',
        args: ['timestamped'],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      const after = Date.now();
      await logger.close();

      const entries = await readLog(logPath);
      for (const entry of entries) {
        assert.ok(entry.ts >= before, `ts ${entry.ts} should be >= ${before}`);
        assert.ok(entry.ts <= after, `ts ${entry.ts} should be <= ${after}`);
      }
    });
  });

  describe('process with environment', () => {
    it('should spawn processes that can access specified working directory', async () => {
      // Write a file to the project dir
      writeFileSync(join(projectDir, 'test-file.txt'), 'hello from project');

      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const logPath = join(sessionsDir, session.id, 'output.jsonl');
      const logger = createSessionLogger(logPath);

      const handle = spawnProcess({
        command: 'cat',
        args: [join(projectDir, 'test-file.txt')],
        sessionId: session.id,
        logger,
        dataDir,
      });

      await handle.waitForExit();
      await logger.close();

      const entries = await readLog(logPath);
      const stdoutEntries = entries.filter(e => e.stream === 'stdout');
      const output = stdoutEntries.map(e => e.content).join('');
      assert.ok(
        output.includes('hello from project'),
        `Should read project file content, got: ${output}`
      );
    });
  });
});
