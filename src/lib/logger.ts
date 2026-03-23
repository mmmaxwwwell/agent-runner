import pino from 'pino';
import type { LogLevel } from './config.ts';

const rootLogger = pino(
  { level: 'info' },
  pino.destination({ fd: 2 })  // JSON to stderr
);

export type ComponentName =
  | 'server'
  | 'session-manager'
  | 'process-spawner'
  | 'sandbox'
  | 'websocket'
  | 'push'
  | 'voice'
  | 'task-parser'
  | 'recovery'
  | 'disk-monitor'
  | 'spec-kit';

/**
 * Set the runtime log level for the root logger and all child loggers.
 */
export function setLevel(level: LogLevel): void {
  rootLogger.level = level;
}

/**
 * Get the current log level.
 */
export function getLevel(): LogLevel {
  return rootLogger.level as LogLevel;
}

/**
 * Create a child logger with a component field for structured logging.
 */
export function createLogger(component: ComponentName): pino.Logger {
  return rootLogger.child({ component });
}

export { rootLogger as logger };
