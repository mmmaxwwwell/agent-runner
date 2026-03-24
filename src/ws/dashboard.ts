import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';
import type { TaskSummary } from '../services/task-parser.js';

const log = createLogger('ws:dashboard');

const MAX_BUFFER = 64 * 1024; // 64KB backpressure threshold
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const MAX_MISSED_PONGS = 3;

/** Set of all connected dashboard clients. */
const dashboardClients = new Set<WebSocket>();

function safeSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== 1) return false; // 1 = OPEN
  if (ws.bufferedAmount > MAX_BUFFER) {
    log.debug({ bufferedAmount: ws.bufferedAmount }, 'Dropping dashboard message due to backpressure');
    return false;
  }
  ws.send(data);
  return true;
}

export interface OnboardingStepMessage {
  type: 'onboarding-step';
  projectId: string;
  step: string;
  status: 'started' | 'completed' | 'skipped' | 'error';
  error?: string;
}

/**
 * Broadcast an onboarding-step message to all connected dashboard clients.
 */
export function broadcastOnboardingStep(update: Omit<OnboardingStepMessage, 'type'>): void {
  const message = JSON.stringify({ type: 'onboarding-step', ...update });
  for (const ws of dashboardClients) {
    safeSend(ws, message);
  }
}

export interface ProjectUpdateMessage {
  type: 'project-update';
  projectId: string;
  activeSession: {
    id: string;
    type: string;
    state: string;
  } | null;
  taskSummary: TaskSummary | null;
  workflow: {
    type: 'new-project' | 'add-feature';
    phase: string;
    iteration: number;
    description: string;
  } | null;
}

/**
 * Broadcast a project-update message to all connected dashboard clients.
 */
export function broadcastProjectUpdate(update: Omit<ProjectUpdateMessage, 'type'>): void {
  const message = JSON.stringify({ type: 'project-update', ...update });
  for (const ws of dashboardClients) {
    safeSend(ws, message);
  }
}

/**
 * Handle a WebSocket connection for the dashboard stream.
 */
export function handleDashboard(ws: WebSocket, _req: IncomingMessage): void {
  log.info('Dashboard stream connected');

  dashboardClients.add(ws);

  // Heartbeat: ping every 30s, terminate after MAX_MISSED_PONGS missed pongs
  let missedPongs = 0;
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== 1) {
      clearInterval(heartbeatInterval);
      return;
    }
    if (missedPongs >= MAX_MISSED_PONGS) {
      log.info('Dead dashboard connection (missed pongs), terminating');
      ws.terminate();
      clearInterval(heartbeatInterval);
      return;
    }
    missedPongs++;
    ws.ping();
  }, HEARTBEAT_INTERVAL);

  ws.on('pong', () => {
    missedPongs = 0;
  });

  ws.on('error', (err) => {
    log.error({ err }, 'Dashboard WebSocket error');
  });

  ws.on('close', () => {
    log.info('Dashboard stream disconnected');
    dashboardClients.delete(ws);
    clearInterval(heartbeatInterval);
  });
}

/** Get the number of connected dashboard clients (for testing). */
export function getDashboardClientCount(): number {
  return dashboardClients.size;
}
