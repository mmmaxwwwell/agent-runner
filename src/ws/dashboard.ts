import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:dashboard');

/**
 * Handle a WebSocket connection for the dashboard stream.
 * Stub — full implementation in T036.
 */
export function handleDashboard(ws: WebSocket, req: IncomingMessage): void {
  log.info('Dashboard stream connected');
  // T036 will implement: broadcast set management, project-update messages,
  // heartbeat ping/pong
  ws.close(1000, 'Not yet implemented');
}
