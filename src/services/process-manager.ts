import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLogger } from '../lib/logger.js';
import type { SessionLogger } from './session-logger.js';

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
  onEvent?: (event: ProcessEvent) => void;
}

/**
 * Spawn a child process, pipe stdout/stderr to the session logger,
 * and handle process exit.
 */
export function spawnProcess(options: SpawnOptions): ProcessHandle {
  const { command, args, sessionId, logger, onEvent } = options;

  log.info({ sessionId, command, args }, 'Spawning process');

  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
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
