import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const TASK_FILE_CONTENT = `# Tasks: Test Project

## Phase 1: Setup

- [x] 1.1 Initialize project
- [ ] 1.2 Configure TypeScript

## Phase 2: Core

- [ ] 2.1 Implement feature
- [ ] 2.2 Write tests
`;

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let projectDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;
let wsBaseUrl: string;

const PORT = 30000 + Math.floor(Math.random() * 10000);

// Valid VAPID keys for testing (pre-generated)
const VAPID_PUBLIC_KEY = 'BEK2EYfxuvIVaN3AD8zmJySnpAbJH0d0krsfVWou2UE0OOmBv8Wuslzb_jwDureGGeoJ1guHi4HgyqAGHyAGI0I';
const VAPID_PRIVATE_KEY = 'lyVcDma4tQXDj6SKHTHSv9MsUZB4juXzJK_JnaDyX2E';

async function api(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const res = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: bodyStr,
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/**
 * Connect and immediately start buffering messages so none are lost
 * between the 'open' event and the first waitForMessage/collectMessages call.
 * The buffer handler is removed on the first drain call.
 */
function connectWs(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}${path}`);
    const buffer: any[] = [];
    const bufferHandler = (data: Buffer | string) => {
      buffer.push(JSON.parse(data.toString()));
    };
    (ws as any).__earlyBuffer = buffer;
    (ws as any).__earlyBufferHandler = bufferHandler;
    ws.on('message', bufferHandler);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    ws.on('open', () => clearTimeout(timeout));
  });
}

/** Stop buffering early messages — call once before setting up own listeners. */
function drainBuffer(ws: WebSocket): any[] {
  const handler = (ws as any).__earlyBufferHandler;
  if (handler) {
    ws.removeListener('message', handler);
    (ws as any).__earlyBufferHandler = null;
  }
  const buffer: any[] = (ws as any).__earlyBuffer || [];
  (ws as any).__earlyBuffer = [];
  return buffer;
}

/**
 * Wait for a message matching predicate. Drains any buffered early messages first.
 */
function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    // Drain and check early buffer
    const buffer = drainBuffer(ws);
    for (const msg of buffer) {
      if (predicate(msg)) {
        return resolve(msg);
      }
    }

    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    const handler = (data: Buffer | string) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    // Drain early buffer first
    const buffer = drainBuffer(ws);
    const messages: any[] = buffer.slice(0, count);
    if (messages.length >= count) return resolve(messages);

    const timeout = setTimeout(() => reject(new Error(`Timeout: received ${messages.length}/${count} messages`)), timeoutMs);
    const handler = (data: Buffer | string) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length >= count) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        resolve(messages);
      }
    };
    ws.on('message', handler);
  });
}

function collectAllMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = drainBuffer(ws);
    const handler = (data: Buffer | string) => {
      messages.push(JSON.parse(data.toString()));
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: '/home/max/git/agent-runner',
      env: {
        ...process.env,
        AGENT_RUNNER_HOST: '127.0.0.1',
        AGENT_RUNNER_PORT: String(PORT),
        AGENT_RUNNER_DATA_DIR: dataDir,
        AGENT_RUNNER_PROJECTS_DIR: projectsDir,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY,
        LOG_LEVEL: 'info',
        ALLOW_UNSANDBOXED: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrOutput = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start within 10s. stderr: ${stderrOutput}`));
    }, 10_000);

    serverProcess.stderr!.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.includes('Agent Runner server started')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited with code ${code}. stderr: ${stderrOutput}`));
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
      resolve();
    }, 3000);
    serverProcess.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    serverProcess.kill('SIGTERM');
  });
}

/**
 * Create a session with pre-written log entries for replay testing.
 * Returns the session ID.
 */
function createSessionWithLog(
  projectId: string,
  entries: Array<{ ts: number; stream: string; seq: number; content: string }>,
  opts: { state?: string; type?: string; question?: string | null; lastTaskId?: string | null } = {},
): string {
  const sessionId = randomUUID();
  const sessionDir = join(dataDir, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const meta = {
    id: sessionId,
    projectId,
    type: opts.type ?? 'task-run',
    state: opts.state ?? 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    lastTaskId: opts.lastTaskId ?? null,
    question: opts.question ?? null,
    exitCode: null,
  };
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  // Write JSONL log entries
  const logPath = join(sessionDir, 'output.jsonl');
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(logPath, lines ? lines + '\n' : '');

  return sessionId;
}

describe('WebSocket API Contract Tests', () => {
  let projectId: string;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'contract-ws-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    projectDir = join(projectsDir, 'test-project');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');
    writeFileSync(join(projectDir, 'tasks.md'), TASK_FILE_CONTENT);

    baseUrl = `http://127.0.0.1:${PORT}`;
    wsBaseUrl = `ws://127.0.0.1:${PORT}`;
    await startServer();

    // Register a project for use in tests
    const res = await api('/api/projects', {
      method: 'POST',
      body: { name: 'ws-contract-test', dir: projectDir },
    });
    assert.equal(res.status, 201);
    projectId = res.body.id;
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Session Stream: /ws/sessions/:id ──────────────────────────────

  describe('Session Stream — Connection', () => {
    it('should connect to /ws/sessions/:id for a valid session', async () => {
      const sessionId = createSessionWithLog(projectId, [
        { ts: 1000, stream: 'system', seq: 1, content: 'Session started' },
      ]);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      assert.ok(ws.readyState === WebSocket.OPEN, 'WebSocket should be open');
      ws.close();
    });

    it('should reject connection for unknown session ID', async () => {
      await assert.rejects(
        () => connectWs('/ws/sessions/nonexistent-session-id'),
        (err: Error) => true,
      );
    });

    it('should reject connection for unknown WebSocket paths', async () => {
      await assert.rejects(
        () => connectWs('/ws/unknown-path'),
        (err: Error) => true,
      );
    });
  });

  // ── Session Stream: output messages ───────────────────────────────

  describe('Session Stream — output message format', () => {
    it('should have type, seq, ts, stream, and content fields per websocket-api.md', async () => {
      const entries = [
        { ts: 1000, stream: 'stdout', seq: 1, content: 'Hello from agent' },
        { ts: 1001, stream: 'stderr', seq: 2, content: 'Warning message' },
        { ts: 1002, stream: 'system', seq: 3, content: 'Task completed' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      const messages = await collectMessages(ws, 4, 5000); // 3 outputs + 1 sync

      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.ok(outputMsgs.length >= 3, `Expected at least 3 output messages, got ${outputMsgs.length}`);

      // Verify each output message matches the contract:
      // { "type": "output", "seq": number, "ts": number, "stream": "stdout"|"stderr"|"system", "content": string }
      for (const msg of outputMsgs) {
        assert.equal(msg.type, 'output');
        assert.equal(typeof msg.seq, 'number', 'seq should be a number');
        assert.equal(typeof msg.ts, 'number', 'ts should be a number');
        assert.ok(['stdout', 'stderr', 'system'].includes(msg.stream), `stream should be stdout/stderr/system, got ${msg.stream}`);
        assert.equal(typeof msg.content, 'string', 'content should be a string');
      }

      ws.close();
    });

    it('should preserve original entry data in output messages', async () => {
      const entries = [
        { ts: 9999, stream: 'stderr', seq: 42, content: 'specific content' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      // Collect both the output and sync messages to avoid race where output
      // arrives before waitForMessage listener is attached
      const messages = await collectMessages(ws, 2, 5000); // 1 output + 1 sync
      const msg = messages.find((m: any) => m.type === 'output');
      assert.ok(msg, 'Should have received an output message');

      assert.equal(msg.ts, 9999);
      assert.equal(msg.stream, 'stderr');
      assert.equal(msg.seq, 42);
      assert.equal(msg.content, 'specific content');

      ws.close();
    });
  });

  // ── Session Stream: sync message ──────────────────────────────────

  describe('Session Stream — sync message format', () => {
    it('should send sync message with type and lastSeq after replay per websocket-api.md', async () => {
      const entries = [
        { ts: 2000, stream: 'stdout', seq: 1, content: 'Line 1' },
        { ts: 2001, stream: 'stdout', seq: 2, content: 'Line 2' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // { "type": "sync", "lastSeq": number }
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');
      assert.equal(syncMsg.type, 'sync');
      assert.equal(typeof syncMsg.lastSeq, 'number', 'sync should include lastSeq');
      assert.equal(syncMsg.lastSeq, 2, 'lastSeq should be the highest seq from replayed entries');

      ws.close();
    });

    it('should send sync with lastSeq=0 for empty log', async () => {
      const sessionId = createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');

      assert.equal(syncMsg.type, 'sync');
      assert.equal(syncMsg.lastSeq, 0, 'lastSeq should be 0 for empty log');

      ws.close();
    });
  });

  // ── Session Stream: replay with lastSeq ───────────────────────────

  describe('Session Stream — replay with lastSeq query param', () => {
    it('should replay only entries with seq > lastSeq', async () => {
      const entries = [
        { ts: 3000, stream: 'stdout', seq: 1, content: 'Entry 1' },
        { ts: 3001, stream: 'stdout', seq: 2, content: 'Entry 2' },
        { ts: 3002, stream: 'stdout', seq: 3, content: 'Entry 3' },
        { ts: 3003, stream: 'stderr', seq: 4, content: 'Entry 4' },
        { ts: 3004, stream: 'system', seq: 5, content: 'Entry 5' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      // Connect with lastSeq=2 — should only replay entries 3, 4, 5
      const ws = await connectWs(`/ws/sessions/${sessionId}?lastSeq=2`);
      const messages = await collectMessages(ws, 4, 5000); // 3 outputs + 1 sync

      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs.length, 3, 'Should replay only entries after lastSeq=2');

      const seqs = outputMsgs.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
      assert.deepEqual(seqs, [3, 4, 5]);

      const syncMsg = messages.find((m: any) => m.type === 'sync');
      assert.ok(syncMsg);
      assert.equal(syncMsg.lastSeq, 5);

      ws.close();
    });

    it('should replay all entries when no lastSeq is provided', async () => {
      const entries = [
        { ts: 4000, stream: 'stdout', seq: 1, content: 'First' },
        { ts: 4001, stream: 'stdout', seq: 2, content: 'Second' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      const messages = await collectMessages(ws, 3, 5000); // 2 outputs + 1 sync

      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs.length, 2, 'Should replay all entries');

      ws.close();
    });

    it('should replay nothing when lastSeq >= max seq', async () => {
      const entries = [
        { ts: 5000, stream: 'stdout', seq: 1, content: 'Only entry' },
      ];
      const sessionId = createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}?lastSeq=1`);
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');

      assert.equal(syncMsg.type, 'sync');
      assert.equal(syncMsg.lastSeq, 1);

      ws.close();
    });
  });

  // ── Session Stream: state message ─────────────────────────────────

  describe('Session Stream — state message format', () => {
    it('should send state message with state, question, taskId for waiting-for-input sessions per websocket-api.md', async () => {
      // { "type": "state", "state": "waiting-for-input", "question": "...", "taskId": "2.1" }
      const sessionId = createSessionWithLog(projectId, [], {
        state: 'waiting-for-input',
        question: 'Which API key should I use?',
        lastTaskId: '2.1',
      });

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      const stateMsg = await waitForMessage(ws, (m: any) => m.type === 'state');
      assert.equal(stateMsg.type, 'state');
      assert.equal(stateMsg.state, 'waiting-for-input');
      assert.equal(typeof stateMsg.question, 'string', 'Should include question');
      assert.ok(stateMsg.question.length > 0, 'Question should be non-empty');
      assert.equal(stateMsg.taskId, '2.1', 'Should include taskId');

      ws.close();
    });
  });

  // ── Session Stream: state change via session stop ─────────────────

  describe('Session Stream — state change broadcast', () => {
    it('should broadcast state change when session is stopped via REST API', async () => {
      const sessionId = createSessionWithLog(projectId, [
        { ts: 6000, stream: 'stdout', seq: 1, content: 'Working...' },
      ]);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Set up listener BEFORE the stop API call
      const stateMsgPromise = waitForMessage(ws, (m: any) => m.type === 'state', 5000);

      // Stop the session
      await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });

      const stateMsg = await stateMsgPromise;
      assert.equal(stateMsg.type, 'state');
      assert.ok(stateMsg.state, 'State message should include state field');

      ws.close();
    });
  });

  // ── Session Stream: client→server input message ───────────────────

  describe('Session Stream — client→server input message', () => {
    it('should accept input messages with type and content fields per websocket-api.md', async () => {
      // Create an interview session in running state
      const sessionId = createSessionWithLog(projectId, [], {
        type: 'interview',
        state: 'running',
      });

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Send input message per contract: { "type": "input", "content": "..." }
      // This should not cause an error (no process stdin to write to, but the message is accepted)
      ws.send(JSON.stringify({ type: 'input', content: 'Test input from client' }));

      // Give server time to process — should not crash
      await new Promise(resolve => setTimeout(resolve, 300));

      assert.equal(ws.readyState, WebSocket.OPEN, 'WebSocket should still be open after sending input');

      ws.close();
    });
  });

  // ── Dashboard Stream: /ws/dashboard ───────────────────────────────

  describe('Dashboard Stream — Connection', () => {
    it('should connect to /ws/dashboard', async () => {
      const ws = await connectWs('/ws/dashboard');
      assert.ok(ws.readyState === WebSocket.OPEN, 'Dashboard WebSocket should be open');
      ws.close();
    });
  });

  describe('Dashboard Stream — project-update message format', () => {
    it('should receive project-update on session state change per websocket-api.md', async () => {
      const ws = await connectWs('/ws/dashboard');

      // Set up listener BEFORE triggering a state change
      const updatePromise = waitForMessage(ws, (m: any) => m.type === 'project-update', 5000);

      // Create and stop a session to trigger a project-update broadcast
      const sessionId = createSessionWithLog(projectId, [
        { ts: 7000, stream: 'stdout', seq: 1, content: 'Dashboard test' },
      ]);

      await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });

      const msg = await updatePromise;

      // Verify format per websocket-api.md:
      // { "type": "project-update", "projectId": "uuid", "activeSession": {...}|null, "taskSummary": {...}|null, "workflow": {...}|null }
      assert.equal(msg.type, 'project-update');
      assert.equal(typeof msg.projectId, 'string', 'Should include projectId');

      // activeSession should be null after stop (or an object)
      if (msg.activeSession !== null) {
        assert.equal(typeof msg.activeSession.id, 'string');
        assert.equal(typeof msg.activeSession.type, 'string');
        assert.equal(typeof msg.activeSession.state, 'string');
      }

      // taskSummary should have the expected shape
      if (msg.taskSummary !== null) {
        assert.equal(typeof msg.taskSummary.total, 'number');
        assert.equal(typeof msg.taskSummary.completed, 'number');
        assert.equal(typeof msg.taskSummary.blocked, 'number');
        assert.equal(typeof msg.taskSummary.skipped, 'number');
        assert.equal(typeof msg.taskSummary.remaining, 'number');
      }

      // workflow can be null or an object
      if (msg.workflow !== null) {
        assert.ok(['new-project', 'add-feature'].includes(msg.workflow.type));
        assert.equal(typeof msg.workflow.phase, 'string');
        assert.equal(typeof msg.workflow.iteration, 'number');
        assert.equal(typeof msg.workflow.description, 'string');
      }

      ws.close();
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────

  describe('Heartbeat', () => {
    it('should receive ping frames from server on session stream per websocket-api.md', async () => {
      const sessionId = createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Server sends ping every 30s per contract
      const pingReceived = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 35_000);
        ws.on('ping', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      assert.ok(pingReceived, 'Should receive a ping frame within 35 seconds');

      ws.close();
    });

    it('should receive ping frames from server on dashboard stream', async () => {
      const ws = await connectWs('/ws/dashboard');

      const pingReceived = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 35_000);
        ws.on('ping', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      assert.ok(pingReceived, 'Dashboard should receive ping frames');

      ws.close();
    });
  });

  // ── All message types are valid JSON with type field ──────────────

  describe('Message envelope', () => {
    it('all server messages should be valid JSON with a type field', async () => {
      // Connect to a session with log entries and in waiting-for-input state
      // to trigger multiple message types (output, sync, state)
      const sessionId = createSessionWithLog(projectId, [
        { ts: 8000, stream: 'stdout', seq: 1, content: 'Test' },
      ], {
        state: 'waiting-for-input',
        question: 'Test question?',
        lastTaskId: '1.2',
      });

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      const messages = await collectAllMessages(ws, 1000);

      assert.ok(messages.length > 0, 'Should receive at least one message');

      for (const msg of messages) {
        assert.equal(typeof msg, 'object', 'Message should be a parsed JSON object');
        assert.equal(typeof msg.type, 'string', 'Every message should have a string type field');
        assert.ok(
          ['output', 'sync', 'state', 'progress', 'phase', 'error', 'project-update'].includes(msg.type),
          `Message type "${msg.type}" should be one of the documented types`,
        );
      }

      ws.close();
    });
  });
});
