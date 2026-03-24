import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLogger } from '../lib/logger.js';
import { parseTasks, parseTaskSummary } from './task-parser.js';
import { transitionState, getSession } from '../models/session.js';
import type { SessionLogger } from './session-logger.js';
import { broadcastSessionState, broadcastSessionProgress } from '../ws/session-stream.js';
import { broadcastProjectUpdate } from '../ws/dashboard.js';
import type { PushService } from './push.js';

const log = createLogger('process-spawner');

export interface ProcessEvent {
  type: 'exit';
  exitCode: number;
  signal: string | null;
}

export interface ProcessExitResult {
  exitCode: number;
  signal: string | null;
}

export interface ProcessHandle {
  pid: number;
  waitForExit: () => Promise<ProcessExitResult>;
  process: ChildProcess;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  sessionId: string;
  logger: SessionLogger;
  dataDir: string;
  env?: Record<string, string>;
  onEvent?: (event: ProcessEvent) => void;
}

/**
 * Spawn a child process, pipe stdout/stderr to the session logger,
 * and handle process exit.
 */
export function spawnProcess(options: SpawnOptions): ProcessHandle {
  const { command, args, sessionId, logger, env, onEvent } = options;

  log.info({ sessionId, command, args }, 'Spawning process');

  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : undefined,
  });

  const pid = child.pid!;

  log.info({ sessionId, pid }, 'Process spawned');

  // Pipe stdout line by line to logger
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      logger.write({ stream: 'stdout', content: line }).catch((err) => {
        log.error({ sessionId, err }, 'Failed to write stdout to log');
      });
    });
  }

  // Pipe stderr line by line to logger
  if (child.stderr) {
    const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    rl.on('line', (line) => {
      logger.write({ stream: 'stderr', content: line }).catch((err) => {
        log.error({ sessionId, err }, 'Failed to write stderr to log');
      });
    });
  }

  const exitPromise = new Promise<ProcessExitResult>((resolve) => {
    child.on('close', (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      const signalStr = signal ?? null;

      log.info({ sessionId, pid, exitCode, signal: signalStr }, 'Process exited');

      const event: ProcessEvent = { type: 'exit', exitCode, signal: signalStr };
      onEvent?.(event);

      resolve({ exitCode, signal: signalStr });
    });
  });

  return {
    pid,
    waitForExit: () => exitPromise,
    process: child,
  };
}

/**
 * Kill a running process. Does not throw if the process has already exited.
 */
export function killProcess(handle: ProcessHandle): void {
  try {
    handle.process.kill('SIGTERM');
  } catch {
    // Process already exited — ignore
  }
}

export interface TaskLoopOptions {
  command: string;
  args: string[];
  sessionId: string;
  projectId: string;
  projectName: string;
  taskFilePath: string;
  logger: SessionLogger;
  dataDir: string;
  env?: Record<string, string>;
  pushService?: PushService;
}

export interface TaskLoopResult {
  outcome: 'completed' | 'waiting-for-input' | 'failed';
  spawnCount: number;
  question?: string | null;
}

/**
 * Run the task-run auto-loop:
 * 1. Parse task file — if no unchecked tasks, mark completed and return.
 * 2. Spawn the agent process.
 * 3. On exit: if non-zero exit code → mark failed.
 * 4. Re-parse task file:
 *    - Any [?] → transition to waiting-for-input with question.
 *    - Unchecked tasks remain, no [?] → loop (spawn again).
 *    - All tasks [x] or [~] → mark completed.
 */
export async function startTaskLoop(options: TaskLoopOptions): Promise<TaskLoopResult> {
  const { command, args, sessionId, projectId, projectName, taskFilePath, logger, dataDir, env, pushService } = options;
  let spawnCount = 0;

  /** Broadcast project-update to dashboard clients with current session & task state. */
  function emitDashboardUpdate(summary: ReturnType<typeof parseTaskSummary>, sessionState: string): void {
    const session = getSession(dataDir, sessionId);
    broadcastProjectUpdate({
      projectId,
      activeSession: session && (session.state === 'running' || session.state === 'waiting-for-input')
        ? { id: session.id, type: session.type, state: session.state }
        : null,
      taskSummary: summary,
      workflow: null,
    });
  }

  // Check before first spawn — if all tasks are already done, don't spawn at all
  const initialSummary = parseTaskSummary(taskFilePath);
  if (initialSummary.remaining === 0 && initialSummary.blocked === 0) {
    await logger.write({ stream: 'system', content: 'All tasks already completed' });
    transitionState(dataDir, sessionId, 'completed', { exitCode: 0 });
    broadcastSessionState(sessionId, { state: 'completed' });
    emitDashboardUpdate(initialSummary, 'completed');
    return { outcome: 'completed', spawnCount: 0 };
  }

  while (true) {
    // Spawn the agent process
    const handle = spawnProcess({
      command,
      args,
      sessionId,
      logger,
      dataDir,
      env,
    });
    spawnCount++;

    log.info({ sessionId, spawnCount, projectId }, 'Task loop: spawned process');

    // Wait for process to exit
    const exitResult = await handle.waitForExit();

    // Non-zero exit → failed, no retry
    if (exitResult.exitCode !== 0) {
      log.warn({ sessionId, exitCode: exitResult.exitCode, spawnCount }, 'Task loop: process crashed');
      await logger.write({ stream: 'system', content: `Process exited with code ${exitResult.exitCode}` });
      transitionState(dataDir, sessionId, 'failed', { exitCode: exitResult.exitCode });
      broadcastSessionState(sessionId, { state: 'failed' });
      const failSummary = parseTaskSummary(taskFilePath);
      emitDashboardUpdate(failSummary, 'failed');
      pushService?.sendToAll({
        title: `Session failed: ${projectName}`,
        body: `Process exited with code ${exitResult.exitCode}`,
        data: { projectId, sessionId },
      }).catch(err => log.warn({ err }, 'Failed to send push notification'));
      return { outcome: 'failed', spawnCount };
    }

    // Re-parse task file after successful exit
    const summary = parseTaskSummary(taskFilePath);

    // Check for blocked tasks
    if (summary.blocked > 0) {
      const tasks = parseTasks(taskFilePath);
      const blockedTask = tasks.find(t => t.status === 'blocked');
      const question = blockedTask?.blockedReason ?? blockedTask?.description ?? 'Task blocked';
      const taskId = blockedTask?.id ?? null;

      log.info({ sessionId, taskId, question, spawnCount }, 'Task loop: blocked task detected');
      await logger.write({ stream: 'system', content: `Task ${taskId} blocked: ${question}` });
      transitionState(dataDir, sessionId, 'waiting-for-input', { question, lastTaskId: taskId ?? undefined });
      broadcastSessionState(sessionId, { state: 'waiting-for-input', question, taskId });
      broadcastSessionProgress(sessionId, summary);
      emitDashboardUpdate(summary, 'waiting-for-input');
      pushService?.sendToAll({
        title: `Input needed: ${projectName}`,
        body: `Task ${taskId}: ${question}`,
        data: { projectId, sessionId, taskId },
      }).catch(err => log.warn({ err }, 'Failed to send push notification'));
      return { outcome: 'waiting-for-input', spawnCount, question };
    }

    // Check if all tasks done
    if (summary.remaining === 0) {
      log.info({ sessionId, spawnCount }, 'Task loop: all tasks completed');
      await logger.write({ stream: 'system', content: 'All tasks completed' });
      transitionState(dataDir, sessionId, 'completed', { exitCode: 0 });
      broadcastSessionState(sessionId, { state: 'completed' });
      broadcastSessionProgress(sessionId, summary);
      emitDashboardUpdate(summary, 'completed');
      pushService?.sendToAll({
        title: `Completed: ${projectName}`,
        body: `All tasks done (${summary.completed}/${summary.total})`,
        data: { projectId, sessionId },
      }).catch(err => log.warn({ err }, 'Failed to send push notification'));
      return { outcome: 'completed', spawnCount };
    }

    // Unchecked tasks remain, no blocked → loop again
    log.info({ sessionId, remaining: summary.remaining, spawnCount }, 'Task loop: unchecked tasks remain, spawning next');
    await logger.write({ stream: 'system', content: `${summary.remaining} tasks remaining, starting next run` });
    broadcastSessionProgress(sessionId, summary);
    emitDashboardUpdate(summary, 'running');
  }
}
