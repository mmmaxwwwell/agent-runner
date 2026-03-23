import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

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

function connectWs(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}${path}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    ws.on('open', () => clearTimeout(timeout));
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
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
    const messages: any[] = [];
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
        VAPID_PUBLIC_KEY: 'test-public-key',
        VAPID_PRIVATE_KEY: 'test-private-key',
        LOG_LEVEL: 'error',
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
async function createSessionWithLog(projectId: string, entries: Array<{ ts: number; stream: string; seq: number; content: string }>): Promise<string> {
  // Create session directory and meta.json directly
  const { randomUUID } = await import('node:crypto');
  const sessionId = randomUUID();
  const sessionDir = join(dataDir, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const meta = {
    id: sessionId,
    projectId,
    type: 'task-run',
    state: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    lastTaskId: null,
    question: null,
    exitCode: null,
  };
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  // Write JSONL log entries
  const logPath = join(sessionDir, 'output.jsonl');
  for (const entry of entries) {
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  }

  return sessionId;
}

describe('WebSocket API: Session Stream Contract Tests', () => {
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
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Connection', () => {
    it('should connect to /ws/sessions/:id for a valid session', async () => {
      // Register a project and create a session
      const projectRes = await api('/api/projects', {
        method: 'POST',
        body: { name: 'ws-test', dir: projectDir },
      });
      assert.equal(projectRes.status, 201);
      const projectId = projectRes.body.id;

      // Create a session with pre-existing log entries
      const sessionId = await createSessionWithLog(projectId, [
        { ts: 1000, stream: 'system', seq: 1, content: 'Session started' },
      ]);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      assert.ok(ws.readyState === WebSocket.OPEN, 'WebSocket should be open');
      ws.close();
    });

    it('should reject connection for unknown session ID', async () => {
      await assert.rejects(
        () => connectWs('/ws/sessions/nonexistent-session-id'),
        (err: Error) => {
          // Expect connection to fail or receive error
          return true;
        },
      );
    });
  });

  describe('Output messages', () => {
    it('should receive output messages with correct format (seq, ts, stream, content)', async () => {
      // Register project if needed
      const listRes = await api('/api/projects');
      let projectId: string;
      if (listRes.body.length === 0) {
        const res = await api('/api/projects', {
          method: 'POST',
          body: { name: 'ws-output-test', dir: projectDir },
        });
        projectId = res.body.id;
      } else {
        projectId = listRes.body[0].id;
      }

      // Create session with log entries
      const entries = [
        { ts: 1000, stream: 'stdout', seq: 1, content: 'Hello from agent' },
        { ts: 1001, stream: 'stderr', seq: 2, content: 'Warning message' },
        { ts: 1002, stream: 'system', seq: 3, content: 'Task completed' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // Should replay the existing entries as output messages
      const messages = await collectMessages(ws, 4, 5000); // 3 outputs + 1 sync

      // Find output messages
      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.ok(outputMsgs.length >= 3, `Expected at least 3 output messages, got ${outputMsgs.length}`);

      // Verify output message format per websocket-api.md
      for (const msg of outputMsgs) {
        assert.equal(msg.type, 'output');
        assert.equal(typeof msg.seq, 'number', 'seq should be a number');
        assert.equal(typeof msg.ts, 'number', 'ts should be a number');
        assert.ok(['stdout', 'stderr', 'system'].includes(msg.stream), `stream should be stdout/stderr/system, got ${msg.stream}`);
        assert.equal(typeof msg.content, 'string', 'content should be a string');
      }

      ws.close();
    });
  });

  describe('Sync message', () => {
    it('should receive sync message after replay with lastSeq', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body[0]?.id;
      assert.ok(projectId);

      const entries = [
        { ts: 2000, stream: 'stdout', seq: 1, content: 'Line 1' },
        { ts: 2001, stream: 'stdout', seq: 2, content: 'Line 2' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // Collect messages until we see a sync
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');

      assert.equal(syncMsg.type, 'sync');
      assert.equal(typeof syncMsg.lastSeq, 'number', 'sync should include lastSeq');
      assert.equal(syncMsg.lastSeq, 2, 'lastSeq should be the highest seq from replayed entries');

      ws.close();
    });
  });

  describe('Replay with lastSeq query param', () => {
    it('should replay only entries with seq > lastSeq when ?lastSeq is provided', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body[0]?.id;
      assert.ok(projectId);

      const entries = [
        { ts: 3000, stream: 'stdout', seq: 1, content: 'Entry 1' },
        { ts: 3001, stream: 'stdout', seq: 2, content: 'Entry 2' },
        { ts: 3002, stream: 'stdout', seq: 3, content: 'Entry 3' },
        { ts: 3003, stream: 'stderr', seq: 4, content: 'Entry 4' },
        { ts: 3004, stream: 'system', seq: 5, content: 'Entry 5' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      // Connect with lastSeq=2 — should only replay entries 3, 4, 5
      const ws = await connectWs(`/ws/sessions/${sessionId}?lastSeq=2`);

      // Expect 3 output messages + 1 sync = 4 messages
      const messages = await collectMessages(ws, 4, 5000);

      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs.length, 3, 'Should replay only entries after lastSeq=2');

      // Verify replayed entries are seq 3, 4, 5
      const seqs = outputMsgs.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
      assert.deepEqual(seqs, [3, 4, 5], 'Should replay entries with seq 3, 4, 5');

      // Verify sync message
      const syncMsg = messages.find((m: any) => m.type === 'sync');
      assert.ok(syncMsg, 'Should receive sync message');
      assert.equal(syncMsg.lastSeq, 5, 'Sync lastSeq should be 5');

      ws.close();
    });

    it('should replay all entries when no lastSeq is provided', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body[0]?.id;
      assert.ok(projectId);

      const entries = [
        { ts: 4000, stream: 'stdout', seq: 1, content: 'First' },
        { ts: 4001, stream: 'stdout', seq: 2, content: 'Second' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // Expect 2 output messages + 1 sync = 3 messages
      const messages = await collectMessages(ws, 3, 5000);

      const outputMsgs = messages.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs.length, 2, 'Should replay all entries');

      ws.close();
    });

    it('should replay nothing when lastSeq >= max seq', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body[0]?.id;
      assert.ok(projectId);

      const entries = [
        { ts: 5000, stream: 'stdout', seq: 1, content: 'Only entry' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      // Connect with lastSeq=1 — no entries to replay
      const ws = await connectWs(`/ws/sessions/${sessionId}?lastSeq=1`);

      // Should receive just the sync message
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');
      assert.equal(syncMsg.type, 'sync');
      assert.equal(syncMsg.lastSeq, 1, 'Sync lastSeq should reflect the highest seq');

      ws.close();
    });
  });

  describe('State messages', () => {
    it('should receive state message with correct format', async () => {
      const listRes = await api('/api/projects');
      const projectId = listRes.body[0]?.id;
      assert.ok(projectId);

      // Create a session in waiting-for-input state
      const { randomUUID } = await import('node:crypto');
      const sessionId = randomUUID();
      const sessionDir = join(dataDir, 'sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });

      const meta = {
        id: sessionId,
        projectId,
        type: 'task-run',
        state: 'waiting-for-input',
        startedAt: new Date().toISOString(),
        endedAt: null,
        pid: null,
        lastTaskId: '2.1',
        question: 'Which API key should I use?',
        exitCode: null,
      };
      writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
      writeFileSync(join(sessionDir, 'output.jsonl'), '');

      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // Should receive a state message reflecting current session state
      const stateMsg = await waitForMessage(ws, (m: any) => m.type === 'state');

      assert.equal(stateMsg.type, 'state');
      assert.equal(stateMsg.state, 'waiting-for-input');
      assert.equal(typeof stateMsg.question, 'string', 'Should include question');
      assert.ok(stateMsg.question.length > 0, 'Question should be non-empty');

      ws.close();
    });
  });
});
