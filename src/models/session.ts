import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type SessionType = 'interview' | 'task-run';
export type SessionState = 'running' | 'waiting-for-input' | 'completed' | 'failed';

export interface Session {
  id: string;
  projectId: string;
  type: SessionType;
  state: SessionState;
  startedAt: string;
  endedAt: string | null;
  pid: number | null;
  lastTaskId: string | null;
  question: string | null;
  exitCode: number | null;
}

export interface CreateSessionInput {
  projectId: string;
  type: SessionType;
}

interface TransitionOptions {
  question?: string;
  exitCode?: number;
  lastTaskId?: string;
}

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  'running': ['waiting-for-input', 'completed', 'failed'],
  'waiting-for-input': ['running'],
  'completed': [],
  'failed': [],
};

function sessionsDir(dataDir: string): string {
  return join(dataDir, 'sessions');
}

function sessionDir(dataDir: string, sessionId: string): string {
  return join(sessionsDir(dataDir), sessionId);
}

function metaPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), 'meta.json');
}

function readMeta(dataDir: string, sessionId: string): Session | null {
  const path = metaPath(dataDir, sessionId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as Session;
}

function writeMeta(dataDir: string, session: Session): void {
  writeFileSync(metaPath(dataDir, session.id), JSON.stringify(session, null, 2) + '\n', 'utf-8');
}

function hasActiveSession(dataDir: string, projectId: string): boolean {
  const dir = sessionsDir(dataDir);
  if (!existsSync(dir)) return false;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    const meta = readMeta(dataDir, entry);
    if (meta && meta.projectId === projectId && (meta.state === 'running' || meta.state === 'waiting-for-input')) {
      return true;
    }
  }
  return false;
}

export function createSession(dataDir: string, input: CreateSessionInput): Session {
  const { projectId, type } = input;

  if (hasActiveSession(dataDir, projectId)) {
    throw new Error(`Project ${projectId} already has an active session`);
  }

  const session: Session = {
    id: randomUUID(),
    projectId,
    type,
    state: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    lastTaskId: null,
    question: null,
    exitCode: null,
  };

  const dir = sessionDir(dataDir, session.id);
  mkdirSync(dir, { recursive: true });
  writeMeta(dataDir, session);

  return session;
}

export function getSession(dataDir: string, sessionId: string): Session | null {
  return readMeta(dataDir, sessionId);
}

export function listSessionsByProject(dataDir: string, projectId: string): Session[] {
  const dir = sessionsDir(dataDir);
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const sessions: Session[] = [];
  for (const entry of entries) {
    const meta = readMeta(dataDir, entry);
    if (meta && meta.projectId === projectId) {
      sessions.push(meta);
    }
  }
  return sessions;
}

export function transitionState(dataDir: string, sessionId: string, newState: SessionState, options?: TransitionOptions): Session {
  const session = readMeta(dataDir, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const allowed = VALID_TRANSITIONS[session.state];
  if (!allowed.includes(newState)) {
    throw new Error(`Invalid state transition: ${session.state} -> ${newState}`);
  }

  session.state = newState;

  switch (newState) {
    case 'waiting-for-input':
      session.pid = null;
      session.question = options?.question ?? null;
      if (options?.lastTaskId !== undefined) {
        session.lastTaskId = options.lastTaskId;
      }
      break;
    case 'completed':
    case 'failed':
      session.pid = null;
      session.endedAt = new Date().toISOString();
      session.exitCode = options?.exitCode ?? null;
      break;
    case 'running':
      session.question = null;
      break;
  }

  writeMeta(dataDir, session);
  return session;
}
