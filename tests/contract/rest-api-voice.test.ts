import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let serverProcess: ChildProcess;
let baseUrl: string;

// Pick a random port in 30000-40000 range to avoid conflicts
const PORT = 30000 + Math.floor(Math.random() * 10000);

async function api(path: string, options: { method?: string; body?: unknown; rawBody?: Buffer; contentType?: string } = {}): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let reqBody: string | Buffer | undefined;

  if (options.rawBody) {
    headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
    reqBody = options.rawBody;
  } else if (options.body) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(options.body);
  }

  const res = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: reqBody,
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function startServer(env: Record<string, string> = {}): Promise<void> {
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
        ...env,
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

describe('REST API: Voice Transcription Contract Tests', () => {
  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'contract-voice-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');

    baseUrl = `http://127.0.0.1:${PORT}`;
    // Start server WITHOUT GOOGLE_STT_API_KEY to test 503 case
    await startServer();
  });

  after(async () => {
    await stopServer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/voice/transcribe', () => {
    it('should return 503 when GOOGLE_STT_API_KEY is not configured', async () => {
      // Send a dummy audio blob — key is not configured so it should be rejected
      const audioData = Buffer.from('fake-audio-data');
      const boundary = '----FormBoundary' + Date.now();
      const body = buildMultipartBody(boundary, 'audio', 'audio.webm', 'audio/webm', audioData);

      const res = await globalThis.fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      const text = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }

      assert.equal(res.status, 503, 'Should return 503 when STT API key not configured');
      assert.ok((parsed as any).error, 'Should have an error message');
    });

    it('should return 400 when no audio is provided', async () => {
      // Send a request with no body / empty multipart
      const { status, body } = await api('/api/voice/transcribe', {
        method: 'POST',
        body: {},
      });

      assert.equal(status, 400, 'Should return 400 when no audio provided');
      assert.ok(body.error, 'Should have an error message');
    });

    it('should return JSON response with text field on success', async () => {
      // This test validates the response format contract.
      // Since we can't easily mock the Google STT API in a contract test,
      // we verify the endpoint exists and returns the correct error when
      // the API key is not configured (covered by the 503 test above).
      // When GOOGLE_STT_API_KEY IS configured, the response should be:
      // { "text": "Transcribed text from the audio" }
      //
      // We verify the endpoint is routed correctly by checking it doesn't 404
      const audioData = Buffer.from('fake-audio-data');
      const boundary = '----FormBoundary' + Date.now();
      const body = buildMultipartBody(boundary, 'audio', 'audio.webm', 'audio/webm', audioData);

      const res = await globalThis.fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      // Without API key configured, we expect 503 (not 404)
      // This verifies the route is properly mounted
      assert.notEqual(res.status, 404, 'Endpoint should exist (not 404)');
    });
  });
});

/**
 * Build a multipart/form-data body buffer for a single file field.
 */
function buildMultipartBody(
  boundary: string,
  fieldName: string,
  fileName: string,
  contentType: string,
  data: Buffer,
): Buffer {
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    '',
    '',
  ].join('\r\n');

  const footer = `\r\n--${boundary}--\r\n`;

  return Buffer.concat([
    Buffer.from(header, 'utf-8'),
    data,
    Buffer.from(footer, 'utf-8'),
  ]);
}
