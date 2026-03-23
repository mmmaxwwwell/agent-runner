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

/**
 * Create a session with pre-written log entries for testing.
 */
async function createSessionWithLog(
  projectId: string,
  entries: Array<{ ts: number; stream: string; seq: number; content: string }>,
  state: string = 'running',
): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  const sessionId = randomUUID();
  const sessionDir = join(dataDir, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const meta = {
    id: sessionId,
    projectId,
    type: 'task-run',
    state,
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    lastTaskId: null,
    question: null,
    exitCode: null,
  };
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const logPath = join(sessionDir, 'output.jsonl');
  for (const entry of entries) {
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  }

  return sessionId;
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
        VAPID_PUBLIC_KEY: 'BEK2EYfxuvIVaN3AD8zmJySnpAbJH0d0krsfVWou2UE0OOmBv8Wuslzb_jwDureGGeoJ1guHi4HgyqAGHyAGI0I',
        VAPID_PRIVATE_KEY: 'lyVcDma4tQXDj6SKHTHSv9MsUZB4juXzJK_JnaDyX2E',
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

describe('WebSocket Streaming Integration Tests', () => {
  let projectId: string;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-integration-'));
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
      body: { name: 'ws-integration-test', dir: projectDir },
    });
    assert.equal(res.status, 201);
    projectId = res.body.id;
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Live output delivery', () => {
    it('should deliver output messages in real-time as a process writes to the session log', async () => {
      // Create a session with no initial entries
      const sessionId = await createSessionWithLog(projectId, []);

      // Connect WebSocket
      const ws = await connectWs(`/ws/sessions/${sessionId}`);

      // Wait for sync (replay of empty log)
      const syncMsg = await waitForMessage(ws, (m: any) => m.type === 'sync');
      assert.equal(syncMsg.type, 'sync');

      // Now append entries to the JSONL log (simulating process output)
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: 1, content: 'Live line 1' }) + '\n');
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: 2, content: 'Live line 2' }) + '\n');

      // Should receive the live output messages
      const messages = await collectMessages(ws, 2, 5000);
      assert.equal(messages.length, 2);

      assert.equal(messages[0].type, 'output');
      assert.equal(messages[0].content, 'Live line 1');
      assert.equal(messages[0].seq, 1);

      assert.equal(messages[1].type, 'output');
      assert.equal(messages[1].content, 'Live line 2');
      assert.equal(messages[1].seq, 2);

      ws.close();
    });

    it('should deliver output to multiple connected clients simultaneously', async () => {
      const sessionId = await createSessionWithLog(projectId, []);

      // Connect clients and set up sync listeners IMMEDIATELY after each connection
      // to avoid losing sync messages while awaiting the second connection
      const ws1 = await connectWs(`/ws/sessions/${sessionId}`);
      const sync1Promise = waitForMessage(ws1, (m: any) => m.type === 'sync');
      const ws2 = await connectWs(`/ws/sessions/${sessionId}`);
      const sync2Promise = waitForMessage(ws2, (m: any) => m.type === 'sync');

      await Promise.all([sync1Promise, sync2Promise]);

      // Set up both output listeners BEFORE appending data
      const msg1Promise = waitForMessage(ws1, (m: any) => m.type === 'output', 5000);
      const msg2Promise = waitForMessage(ws2, (m: any) => m.type === 'output', 5000);

      // Append an entry
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: 1, content: 'Broadcast message' }) + '\n');

      // Both clients should receive it
      const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

      assert.equal(msg1.content, 'Broadcast message');
      assert.equal(msg2.content, 'Broadcast message');

      ws1.close();
      ws2.close();
    });

    it('should include correct fields in live output messages', async () => {
      const sessionId = await createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      const now = Date.now();
      appendFileSync(logPath, JSON.stringify({ ts: now, stream: 'stderr', seq: 1, content: 'Error output' }) + '\n');

      const msg = await waitForMessage(ws, (m: any) => m.type === 'output', 5000);

      assert.equal(msg.type, 'output');
      assert.equal(typeof msg.seq, 'number');
      assert.equal(typeof msg.ts, 'number');
      assert.equal(msg.stream, 'stderr');
      assert.equal(msg.content, 'Error output');

      ws.close();
    });
  });

  describe('Reconnect with lastSeq replay', () => {
    it('should replay missed entries when reconnecting with lastSeq', async () => {
      // Create session with 5 entries
      const entries = [
        { ts: 10000, stream: 'stdout', seq: 1, content: 'Line 1' },
        { ts: 10001, stream: 'stdout', seq: 2, content: 'Line 2' },
        { ts: 10002, stream: 'stdout', seq: 3, content: 'Line 3' },
        { ts: 10003, stream: 'stdout', seq: 4, content: 'Line 4' },
        { ts: 10004, stream: 'stdout', seq: 5, content: 'Line 5' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      // First connection — get all entries
      const ws1 = await connectWs(`/ws/sessions/${sessionId}`);
      const allMsgs = await collectMessages(ws1, 6, 5000); // 5 outputs + 1 sync
      const outputMsgs1 = allMsgs.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs1.length, 5);
      ws1.close();

      // Simulate more entries arriving while disconnected
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      appendFileSync(logPath, JSON.stringify({ ts: 10005, stream: 'stdout', seq: 6, content: 'Line 6' }) + '\n');
      appendFileSync(logPath, JSON.stringify({ ts: 10006, stream: 'stdout', seq: 7, content: 'Line 7' }) + '\n');

      // Reconnect with lastSeq=5 — should only get entries 6 and 7
      const ws2 = await connectWs(`/ws/sessions/${sessionId}?lastSeq=5`);
      const reconnectMsgs = await collectMessages(ws2, 3, 5000); // 2 outputs + 1 sync

      const outputMsgs2 = reconnectMsgs.filter((m: any) => m.type === 'output');
      assert.equal(outputMsgs2.length, 2, 'Should replay only missed entries');

      const seqs = outputMsgs2.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
      assert.deepEqual(seqs, [6, 7]);

      const syncMsg = reconnectMsgs.find((m: any) => m.type === 'sync');
      assert.ok(syncMsg);
      assert.equal(syncMsg.lastSeq, 7);

      ws2.close();
    });

    it('should transition seamlessly from replay to live streaming after reconnect', async () => {
      const entries = [
        { ts: 20000, stream: 'stdout', seq: 1, content: 'Before disconnect' },
        { ts: 20001, stream: 'stdout', seq: 2, content: 'Missed while away' },
      ];
      const sessionId = await createSessionWithLog(projectId, entries);

      // Reconnect with lastSeq=1 — should get entry 2 as replay
      const ws = await connectWs(`/ws/sessions/${sessionId}?lastSeq=1`);

      // Collect replay + sync together to avoid race
      const initialMsgs = await collectMessages(ws, 2, 5000); // 1 output + 1 sync
      const replayMsg = initialMsgs.find((m: any) => m.type === 'output');
      assert.ok(replayMsg, 'Should have received a replay output message');
      assert.equal(replayMsg.seq, 2, 'Should replay the missed entry');
      assert.equal(replayMsg.content, 'Missed while away');

      // Small delay to ensure server-side watcher is fully initialized
      await new Promise(resolve => setTimeout(resolve, 500));

      // Set up listener BEFORE appending
      const liveMsgPromise = waitForMessage(ws, (m: any) => m.type === 'output' && m.seq === 3, 10000);

      // Now append a new entry (live output after reconnect)
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: 3, content: 'Live after reconnect' }) + '\n');

      // Should receive the live message
      const liveMsg = await liveMsgPromise;
      assert.equal(liveMsg.content, 'Live after reconnect');

      ws.close();
    });
  });

  describe('Backpressure handling', () => {
    it('should not crash or hang when sending to a slow client', async () => {
      // This test verifies that the server gracefully handles a slow client
      // by checking bufferedAmount before each send (safeSend pattern).
      // On localhost, TCP buffers absorb data quickly, so we verify the server
      // remains functional rather than testing actual message drops.
      const sessionId = await createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Pause the client to simulate slow consumer
      ws.pause();

      // Write many large entries
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      const largeContent = 'X'.repeat(4096); // 4KB per entry
      for (let i = 1; i <= 30; i++) {
        appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: i, content: largeContent }) + '\n');
      }

      // Let server process the writes
      await new Promise(resolve => setTimeout(resolve, 500));

      // Resume and collect messages — server should still be functional
      ws.resume();
      const messages = await collectAllMessages(ws, 2000);
      const outputMsgs = messages.filter((m: any) => m.type === 'output');

      // We should receive at least some messages (server didn't crash)
      assert.ok(
        outputMsgs.length > 0,
        `Expected at least some output messages, got ${outputMsgs.length}`,
      );
      // And no more than what was written (no duplication)
      assert.ok(
        outputMsgs.length <= 30,
        `Expected at most 30 messages, got ${outputMsgs.length} (duplication bug)`,
      );

      ws.close();
    });
  });

  describe('Heartbeat ping/pong', () => {
    it('should receive ping frames from the server', async () => {
      const sessionId = await createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Server should send ping every 30 seconds per websocket-api.md.
      // For integration test, wait for one ping frame within a reasonable timeout.
      const pingReceived = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 35_000); // slightly more than 30s
        ws.on('ping', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      assert.ok(pingReceived, 'Should receive a ping frame from the server within 35 seconds');

      ws.close();
    });

    it('should keep connection alive when pong is sent in response to ping', async () => {
      const sessionId = await createSessionWithLog(projectId, []);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // The ws library auto-responds to pings with pongs by default.
      // Wait for 2 ping cycles to verify the connection stays alive.
      let pingCount = 0;
      const twoSurvived = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 70_000); // ~2 cycles
        ws.on('ping', () => {
          pingCount++;
          if (pingCount >= 2) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
        ws.on('close', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      assert.ok(twoSurvived, 'Connection should survive at least 2 ping/pong cycles');
      assert.ok(ws.readyState === WebSocket.OPEN, 'WebSocket should still be open');

      ws.close();
    });
  });

  describe('Client cleanup on disconnect', () => {
    it('should remove client from broadcast set when WebSocket closes', async () => {
      const sessionId = await createSessionWithLog(projectId, []);

      // Connect clients and set up sync listeners IMMEDIATELY to avoid losing messages
      const ws1 = await connectWs(`/ws/sessions/${sessionId}`);
      const sync1Promise = waitForMessage(ws1, (m: any) => m.type === 'sync');
      const ws2 = await connectWs(`/ws/sessions/${sessionId}`);
      const sync2Promise = waitForMessage(ws2, (m: any) => m.type === 'sync');

      await Promise.all([sync1Promise, sync2Promise]);

      // Close first client and wait for cleanup
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Set up listener BEFORE writing to avoid race
      const msgPromise = waitForMessage(ws2, (m: any) => m.type === 'output', 5000);

      // Write an entry — only ws2 should receive it (ws1 was removed)
      const logPath = join(dataDir, 'sessions', sessionId, 'output.jsonl');
      appendFileSync(logPath, JSON.stringify({ ts: Date.now(), stream: 'stdout', seq: 1, content: 'After ws1 closed' }) + '\n');

      const msg = await msgPromise;
      assert.equal(msg.content, 'After ws1 closed');

      // Verify ws2 still works — no errors from trying to write to ws1
      ws2.close();
    });
  });

  describe('State change delivery', () => {
    it('should deliver state change messages to connected WebSocket clients', async () => {
      // Create a session in running state
      const sessionId = await createSessionWithLog(projectId, [
        { ts: 30000, stream: 'stdout', seq: 1, content: 'Working...' },
      ]);

      const ws = await connectWs(`/ws/sessions/${sessionId}`);
      await waitForMessage(ws, (m: any) => m.type === 'sync');

      // Set up listener BEFORE the API call to avoid race condition
      const stateMsgPromise = waitForMessage(ws, (m: any) => m.type === 'state', 5000);

      // Stop the session via API — this triggers a state change broadcast
      const stopRes = await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });

      // Should receive a state message via WebSocket
      const stateMsg = await stateMsgPromise;
      assert.equal(stateMsg.type, 'state');
      assert.ok(stateMsg.state, 'State message should include state field');

      ws.close();
    });
  });
});
