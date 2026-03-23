import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { watch, statSync, existsSync, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../lib/logger.js';
import { readLog, readLogFromOffset, type SessionLogEntry } from '../services/session-logger.js';
import { getSession } from '../models/session.js';
import { getActiveProcess } from '../services/process-registry.js';

const log = createLogger('ws:session-stream');

const MAX_BUFFER = 64 * 1024; // 64KB backpressure threshold
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const MAX_MISSED_PONGS = 3;
const POLL_INTERVAL = 100; // ms — fallback polling interval

/** A connected client with a readiness flag (ready = replay complete). */
interface ClientEntry {
  ws: WebSocket;
  ready: boolean;
}

/** Broadcast set: sessionId → Set<ClientEntry> */
const sessionClients = new Map<string, Set<ClientEntry>>();

/** Per-session file watcher state */
interface SessionWatchState {
  path: string;
  watcher: FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval>;
  byteOffset: number;
  reading: boolean;
}
const sessionWatchers = new Map<string, SessionWatchState>();

let dataDir = '';

/** Must be called at startup before any connections are accepted. */
export function initSessionStream(dir: string): void {
  dataDir = dir;
}

function getLogPath(sessionId: string): string {
  return join(dataDir, 'sessions', sessionId, 'output.jsonl');
}

function safeSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== 1) return false; // 1 = OPEN
  if (ws.bufferedAmount > MAX_BUFFER) {
    log.debug({ bufferedAmount: ws.bufferedAmount }, 'Dropping message due to backpressure');
    return false;
  }
  ws.send(data);
  return true;
}

/** Broadcast a JSON message to all READY clients watching a session. */
function broadcastToSession(sessionId: string, message: string): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  for (const client of clients) {
    if (client.ready) {
      safeSend(client.ws, message);
    }
  }
}

/** Broadcast a state change to all clients watching a session. */
export function broadcastSessionState(sessionId: string, stateData: { state: string; question?: string | null; taskId?: string | null }): void {
  broadcastToSession(sessionId, JSON.stringify({ type: 'state', ...stateData }));
}

/** Broadcast a progress update to all clients watching a session. */
export function broadcastSessionProgress(sessionId: string, taskSummary: { total: number; completed: number; blocked: number; skipped: number; remaining: number }): void {
  broadcastToSession(sessionId, JSON.stringify({ type: 'progress', taskSummary }));
}

/** Broadcast a single output entry to all clients watching a session. */
export function broadcastSessionOutput(sessionId: string, entry: SessionLogEntry): void {
  broadcastToSession(sessionId, JSON.stringify({
    type: 'output',
    seq: entry.seq,
    ts: entry.ts,
    stream: entry.stream,
    content: entry.content,
  }));
}

/**
 * Read new entries from a session's log file and broadcast them.
 * Uses a lock + re-check loop to avoid missing data.
 */
async function readAndBroadcast(sessionId: string, state: SessionWatchState): Promise<void> {
  if (state.reading) return;
  state.reading = true;
  try {
    let fileSize: number;
    try {
      fileSize = statSync(state.path).size;
    } catch {
      return;
    }
    if (fileSize <= state.byteOffset) return;

    const newEntries = await readLogFromOffset(state.path, state.byteOffset);

    // Re-stat after read to capture actual EOF (stream reads to current EOF)
    try {
      state.byteOffset = statSync(state.path).size;
    } catch {
      state.byteOffset = fileSize;
    }

    for (const entry of newEntries) {
      broadcastToSession(sessionId, JSON.stringify({
        type: 'output',
        seq: entry.seq,
        ts: entry.ts,
        stream: entry.stream,
        content: entry.content,
      }));
    }
  } catch (err) {
    log.error({ sessionId, err }, 'Error reading new log entries');
  } finally {
    state.reading = false;
  }
}

/**
 * Start (or reuse) a watcher for a session's output.jsonl.
 * Uses fs.watch (inotify) for fast detection + setInterval as fallback.
 */
function ensureWatcher(sessionId: string, initialOffset: number): void {
  if (sessionWatchers.has(sessionId)) {
    // Update offset to latest if a new client provides a higher offset
    const existing = sessionWatchers.get(sessionId)!;
    if (initialOffset > existing.byteOffset) {
      existing.byteOffset = initialOffset;
    }
    return;
  }

  const path = getLogPath(sessionId);

  // Ensure the file exists
  if (!existsSync(path)) {
    writeFileSync(path, '', 'utf-8');
  }

  const trigger = () => {
    readAndBroadcast(sessionId, state).catch(err => {
      log.error({ sessionId, err }, 'Error in watcher callback');
    });
  };

  // Try inotify-based watcher for immediate detection
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(path, trigger);
  } catch {
    log.debug({ sessionId }, 'fs.watch failed, relying on polling');
  }

  const state: SessionWatchState = {
    path,
    watcher,
    pollTimer: setInterval(trigger, POLL_INTERVAL),
    byteOffset: initialOffset,
    reading: false,
  };

  sessionWatchers.set(sessionId, state);
}

/** Clean up watcher when no more clients are watching a session. */
function cleanupWatcher(sessionId: string): void {
  const state = sessionWatchers.get(sessionId);
  if (state) {
    state.watcher?.close();
    clearInterval(state.pollTimer);
    sessionWatchers.delete(sessionId);
  }
}

/**
 * Handle a WebSocket connection for session output streaming.
 */
export function handleSessionStream(ws: WebSocket, _req: IncomingMessage, sessionId: string, lastSeq: number | null): void {
  log.info({ sessionId, lastSeq }, 'Session stream connected');

  // Verify session exists
  const session = getSession(dataDir, sessionId);
  if (!session) {
    log.warn({ sessionId }, 'Session not found, closing connection');
    ws.close(4004, 'Session not found');
    return;
  }

  // Add to broadcast set (not ready until replay completes)
  let clients = sessionClients.get(sessionId);
  if (!clients) {
    clients = new Set();
    sessionClients.set(sessionId, clients);
  }
  const clientEntry: ClientEntry = { ws, ready: false };
  clients.add(clientEntry);

  // Replay and setup (async)
  const path = getLogPath(sessionId);

  (async () => {
    // Read existing log entries
    let entries: SessionLogEntry[] = [];
    let fileSize = 0;

    if (existsSync(path)) {
      try {
        entries = await readLog(path);
        fileSize = statSync(path).size;
      } catch {
        // Empty or missing log — continue with no replay
      }
    }

    // Filter entries by lastSeq
    const filterSeq = lastSeq ?? 0;
    const toReplay = entries.filter(e => e.seq > filterSeq);

    // Send replayed entries as output messages
    for (const entry of toReplay) {
      safeSend(ws, JSON.stringify({
        type: 'output',
        seq: entry.seq,
        ts: entry.ts,
        stream: entry.stream,
        content: entry.content,
      }));
    }

    // Send sync message
    const maxSeq = entries.length > 0
      ? Math.max(...entries.map(e => e.seq))
      : (lastSeq ?? 0);
    safeSend(ws, JSON.stringify({ type: 'sync', lastSeq: maxSeq }));

    // Send current state if session is in a notable state
    if (session.state === 'waiting-for-input') {
      safeSend(ws, JSON.stringify({
        type: 'state',
        state: session.state,
        question: session.question,
        taskId: session.lastTaskId,
      }));
    }

    // Mark client as ready for live output broadcasts
    clientEntry.ready = true;

    // Start file watcher for live output (uses fileSize as offset to avoid replaying again)
    ensureWatcher(sessionId, fileSize);

  })().catch(err => {
    log.error({ sessionId, err }, 'Error during session stream setup');
    ws.close(1011, 'Internal error');
  });

  // Heartbeat: ping every 30s, terminate after MAX_MISSED_PONGS missed pongs
  let missedPongs = 0;
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== 1) {
      clearInterval(heartbeatInterval);
      return;
    }
    if (missedPongs >= MAX_MISSED_PONGS) {
      log.info({ sessionId }, 'Dead connection (missed pongs), terminating');
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

  // Handle client→server messages (input for interview sessions)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as { type?: string; content?: string };
      if (msg.type === 'input' && typeof msg.content === 'string') {
        const currentSession = getSession(dataDir, sessionId);
        if (!currentSession || currentSession.type !== 'interview' || currentSession.state !== 'running') {
          log.debug({ sessionId, state: currentSession?.state, type: currentSession?.type }, 'Ignoring input: session not an active interview');
          return;
        }
        const handle = getActiveProcess(sessionId);
        if (handle && handle.process.stdin && !handle.process.stdin.destroyed) {
          handle.process.stdin.write(msg.content + '\n');
          log.debug({ sessionId }, 'Forwarded input to process stdin');
        } else {
          log.warn({ sessionId }, 'No active process stdin to write to');
        }
      }
    } catch {
      log.debug({ sessionId }, 'Ignoring unparseable WebSocket message');
    }
  });

  ws.on('error', (err) => {
    log.error({ sessionId, err }, 'WebSocket error');
  });

  // Cleanup on close
  ws.on('close', () => {
    log.info({ sessionId }, 'Session stream disconnected');
    const set = sessionClients.get(sessionId);
    if (set) {
      set.delete(clientEntry);
      if (set.size === 0) {
        sessionClients.delete(sessionId);
        cleanupWatcher(sessionId);
      }
    }
    clearInterval(heartbeatInterval);
  });
}
