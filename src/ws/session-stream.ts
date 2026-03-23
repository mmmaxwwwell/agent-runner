import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:session-stream');

/**
 * Handle a WebSocket connection for session output streaming.
 * Stub — full implementation in T035.
 */
export function handleSessionStream(ws: WebSocket, req: IncomingMessage, sessionId: string, lastSeq: number | null): void {
  log.info({ sessionId, lastSeq }, 'Session stream connected');
  // T035 will implement: replay from JSONL, sync message, live output forwarding,
  // broadcast set management, heartbeat, backpressure
  ws.close(1000, 'Not yet implemented');
}
