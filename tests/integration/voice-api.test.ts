/**
 * Integration Tests: Voice Transcription API
 *
 * Validates the POST /api/voice/transcribe endpoint behavior including
 * missing audio (400), missing API key (503), and valid audio handling.
 *
 * Validates UI_FLOW.md § Settings (voice backend), § New Project (mic button),
 * § Add Feature (mic button), § API Endpoint Summary
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

let tmpDir: string;
let dataDir: string;
let projectsDir: string;
let baseUrl: string;

// Server WITHOUT Google STT API key (for 503 tests)
let serverNoKey: ChildProcess;
const PORT_NO_KEY = 30000 + Math.floor(Math.random() * 10000);

// Server WITH Google STT API key (for audio handling tests)
let serverWithKey: ChildProcess;
const PORT_WITH_KEY = PORT_NO_KEY + 1;

function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: '/home/max/git/agent-runner',
      env: {
        ...process.env,
        AGENT_RUNNER_HOST: '127.0.0.1',
        AGENT_RUNNER_PORT: String(port),
        AGENT_RUNNER_DATA_DIR: env['AGENT_RUNNER_DATA_DIR']!,
        AGENT_RUNNER_PROJECTS_DIR: projectsDir,
        ALLOW_UNSANDBOXED: 'true',
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

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.includes('Agent Runner server started')) {
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited with code ${code}. stderr: ${stderrOutput}`));
      }
    });
  });
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
      resolve();
    }, 3000);
    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

/**
 * Build a minimal multipart/form-data body with a single file field.
 */
function buildMultipartBody(
  fieldName: string,
  fileData: Buffer,
  filename: string,
  contentType: string,
): { body: Buffer; boundary: string } {
  const boundary = '----TestBoundary' + Date.now();
  const header = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`,
    `Content-Type: ${contentType}\r\n`,
    '\r\n',
  ].join('');
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    fileData,
    Buffer.from(footer, 'utf-8'),
  ]);

  return { body, boundary };
}

describe('Voice Transcription API Integration Tests', () => {
  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'voice-api-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(dataDir, 'projects.json'), '[]\n');
    writeFileSync(join(dataDir, 'push-subscriptions.json'), '[]\n');

    // Start server without Google STT API key
    serverNoKey = await startServer(PORT_NO_KEY, {
      AGENT_RUNNER_DATA_DIR: dataDir,
    });
  });

  after(async () => {
    await stopServer(serverNoKey);
    if (serverWithKey) await stopServer(serverWithKey);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Validates UI_FLOW.md § API Endpoint Summary — POST /api/voice/transcribe
  // Validates UI_FLOW.md § New Project — Voice transcription failure graceful fallback
  describe('No audio provided (400)', () => {
    it('should return 400 when request has no body', async () => {
      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        { method: 'POST' },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.equal(body.error, 'No audio provided');
    });

    it('should return 400 when multipart body has no audio field', async () => {
      const boundary = '----TestBoundary' + Date.now();
      const content = [
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="notaudio"; filename="test.txt"\r\n',
        'Content-Type: text/plain\r\n',
        '\r\n',
        'hello',
        `\r\n--${boundary}--\r\n`,
      ].join('');

      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: Buffer.from(content),
        },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.equal(body.error, 'No audio provided');
    });

    it('should return 400 when multipart audio field is empty', async () => {
      const { body: multipartBody, boundary } = buildMultipartBody(
        'audio',
        Buffer.alloc(0),
        'empty.webm',
        'audio/webm',
      );

      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: multipartBody,
        },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.equal(body.error, 'No audio provided');
    });

    it('should return 400 for non-multipart content type with no audio', async () => {
      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: Buffer.from('not audio data'),
        },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.equal(body.error, 'No audio provided');
    });
  });

  // Validates UI_FLOW.md § Settings — cloud STT availability check
  // When Google STT API key is not configured, endpoint returns 503
  describe('Missing Google STT API key (503)', () => {
    it('should return 503 when audio is provided but no API key configured', async () => {
      // Send valid multipart audio to server that has no GOOGLE_STT_API_KEY
      const fakeAudio = Buffer.from('fake-webm-audio-data-for-testing');
      const { body: multipartBody, boundary } = buildMultipartBody(
        'audio',
        fakeAudio,
        'recording.webm',
        'audio/webm',
      );

      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: multipartBody,
        },
      );
      assert.equal(res.status, 503);
      const body = await res.json() as any;
      assert.equal(body.error, 'Google Speech-to-Text API key not configured');
    });
  });

  // Validates UI_FLOW.md § API Endpoint Summary — POST /api/voice/transcribe
  describe('Invalid multipart boundary', () => {
    it('should return 400 when multipart content-type has no boundary', async () => {
      const res = await globalThis.fetch(
        `http://127.0.0.1:${PORT_NO_KEY}/api/voice/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data' },
          body: Buffer.from('garbage'),
        },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.equal(body.error, 'Invalid multipart boundary');
    });
  });
});
