import type { ProcessHandle } from './process-manager.js';

/**
 * Shared registry of active process handles by session ID.
 * Extracted to its own module to avoid circular dependencies between
 * session routes (which register processes) and WebSocket handlers
 * (which need to write to process stdin for interview sessions).
 */
const activeProcesses = new Map<string, ProcessHandle>();

export function registerProcess(sessionId: string, handle: ProcessHandle): void {
  activeProcesses.set(sessionId, handle);
}

export function unregisterProcess(sessionId: string): void {
  activeProcesses.delete(sessionId);
}

export function getActiveProcess(sessionId: string): ProcessHandle | undefined {
  return activeProcesses.get(sessionId);
}
