import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../lib/logger.js';
import { getSession, transitionState } from '../models/session.js';
import { getProject } from '../models/project.js';
import { buildCommand } from './sandbox.js';
import { startTaskLoop } from './process-manager.js';
import { createSessionLogger } from './session-logger.js';
import type { PushService } from './push.js';

const log = createLogger('recovery');

const DEFAULT_TASK_RUN_PROMPT = 'Read the task list, find the next unchecked task, implement it, verify it passes, mark it complete, and commit.';

export interface RecoveryResult {
  resumed: number;
  waitingRestored: number;
  failed: number;
}

/**
 * On server startup, scan all sessions and recover those that were
 * interrupted by a server crash/restart.
 *
 * - "running" task-run sessions → re-spawn the task loop from the last task
 * - "running" interview sessions → mark failed (context lost, can't resume)
 * - "waiting-for-input" sessions → leave as-is (user will provide input)
 */
export async function resumeAll(dataDir: string, pushService?: PushService, agentFrameworkDir?: string): Promise<RecoveryResult> {
  const result: RecoveryResult = { resumed: 0, waitingRestored: 0, failed: 0 };

  const sessionsDir = join(dataDir, 'sessions');
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    log.info('No sessions directory found, nothing to recover');
    return result;
  }

  for (const entry of entries) {
    const session = getSession(dataDir, entry);
    if (!session) continue;

    if (session.state === 'waiting-for-input') {
      // Restore waiting state — nothing to do, just log it
      log.info({ sessionId: session.id, projectId: session.projectId, question: session.question },
        'Restored waiting-for-input session');
      result.waitingRestored++;
      continue;
    }

    if (session.state !== 'running') continue;

    // Session was "running" when server crashed — attempt recovery
    const project = getProject(dataDir, session.projectId);
    if (!project) {
      log.warn({ sessionId: session.id, projectId: session.projectId },
        'Cannot recover session: project not found, marking failed');
      transitionState(dataDir, session.id, 'failed', { exitCode: -1 });
      result.failed++;
      continue;
    }

    if (session.type === 'interview') {
      // Interview sessions can't be resumed — agent context is lost
      log.warn({ sessionId: session.id, projectId: session.projectId },
        'Cannot recover interview session (context lost), marking failed');
      const logger = createSessionLogger(join(dataDir, 'sessions', session.id, 'output.jsonl'));
      await logger.write({ stream: 'system', content: 'Session interrupted by server restart — interview context lost' });
      transitionState(dataDir, session.id, 'failed', { exitCode: -1 });
      result.failed++;
      continue;
    }

    // task-run session — re-spawn the task loop
    log.info({ sessionId: session.id, projectId: session.projectId },
      'Recovering task-run session: restarting task loop');

    let sandboxCmd;
    try {
      sandboxCmd = buildCommand(project.dir, 'task-run', {
        agentFrameworkDir: agentFrameworkDir ?? join(dataDir, 'agent-framework'),
        prompt: DEFAULT_TASK_RUN_PROMPT,
      });
    } catch (err) {
      log.error({ sessionId: session.id, err },
        'Cannot recover session: sandbox unavailable, marking failed');
      transitionState(dataDir, session.id, 'failed', { exitCode: -1 });
      result.failed++;
      continue;
    }

    const logPath = join(dataDir, 'sessions', session.id, 'output.jsonl');
    const logger = createSessionLogger(logPath);
    await logger.write({ stream: 'system', content: 'Resuming session after server restart' });

    const taskFilePath = join(project.dir, project.taskFile);

    // Start the task loop in the background
    startTaskLoop({
      command: sandboxCmd.command,
      args: sandboxCmd.args,
      sessionId: session.id,
      projectId: project.id,
      projectName: project.name,
      taskFilePath,
      logger,
      dataDir,
      pushService,
    }).then((loopResult) => {
      log.info({ sessionId: session.id, outcome: loopResult.outcome, spawnCount: loopResult.spawnCount },
        'Recovered task loop finished');
    }).catch((err) => {
      log.error({ sessionId: session.id, err }, 'Recovered task loop error');
    });

    result.resumed++;
  }

  log.info({
    resumed: result.resumed,
    waitingRestored: result.waitingRestored,
    failed: result.failed,
  }, 'Recovery complete');

  return result;
}
