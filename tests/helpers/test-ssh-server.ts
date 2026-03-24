/**
 * Test SSH server for integration tests.
 *
 * Uses the `ssh2` library to create an SSH server that:
 * - Accepts publickey auth using the test ECDSA P-256 keypair from test-keypair.ts
 * - Serves git commands against a local bare git repo
 * - Provides start/stop helpers for integration tests
 *
 * Per FR-109: enables unattended end-to-end SSH agent bridge testing.
 */

import ssh2 from 'ssh2';
import type {
  Connection,
  AuthContext,
  PublicKeyAuthContext,
  Session,
  ServerChannel,
  AcceptConnection,
  RejectConnection,
  ExecInfo,
} from 'ssh2';

const { Server: SSHServer } = ssh2;
import { generateKeyPairSync, createPrivateKey, timingSafeEqual } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTestKeypair } from './test-keypair.js';

export interface TestSSHServerOptions {
  /** Port to listen on. Default: 0 (random available port). */
  port?: number;
  /** Host to listen on. Default: '127.0.0.1'. */
  host?: string;
}

export interface TestSSHServerInfo {
  /** The port the server is listening on. */
  port: number;
  /** The host the server is listening on. */
  host: string;
  /** Path to the local bare git repo served by this server. */
  bareRepoPath: string;
  /** SSH URL for cloning, e.g. ssh://test@127.0.0.1:2222/repo.git */
  sshUrl: string;
  /** Test private key in SEC1 PEM format (for ssh2 Client compatibility). */
  clientPrivateKey: string;
}

/**
 * Convert a PKCS8-encoded EC private key to SEC1 format.
 * ssh2 library cannot parse PKCS8 EC keys — it requires SEC1 ("BEGIN EC PRIVATE KEY").
 */
function convertPkcs8ToSec1(pkcs8Pem: string): string {
  const keyObj = createPrivateKey(pkcs8Pem);
  return keyObj.export({ type: 'sec1', format: 'pem' }) as string;
}

/**
 * Generate a host key for the test SSH server.
 * Uses RSA because ssh2 requires OpenSSH-compatible key formats.
 */
function generateHostKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return privateKey;
}

/**
 * Create a temporary bare git repo with an initial commit.
 * Returns the path to the bare repo.
 */
function createBareRepo(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-runner-test-repo-'));
  const workDir = join(tempDir, 'work');
  const bareDir = join(tempDir, 'repo.git');

  // Create a working repo with an initial commit
  mkdirSync(workDir, { recursive: true });
  execSync('git init', { cwd: workDir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: workDir, stdio: 'ignore' });
  writeFileSync(join(workDir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: workDir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: workDir, stdio: 'ignore' });

  // Clone as bare repo
  execSync(`git clone --bare "${workDir}" "${bareDir}"`, { stdio: 'ignore' });

  // Clean up the working copy
  rmSync(workDir, { recursive: true, force: true });

  return bareDir;
}

/**
 * Parse the SSH public key blob from authorized_keys format to raw key data.
 * Returns the raw key data buffer for comparison.
 */
function parseAuthorizedKeyBlob(authorizedKeysLine: string): Buffer {
  const parts = authorizedKeysLine.split(' ');
  return Buffer.from(parts[1], 'base64');
}

/**
 * A test SSH server that accepts the test keypair and serves git commands
 * against a local bare repo.
 */
export class TestSSHServer {
  private server: SSHServer | null = null;
  private hostKey: string;
  private authorizedKeyBlob: Buffer;
  private _clientPrivateKey: string;
  private _bareRepoPath: string | null = null;
  private _tempDir: string | null = null;
  private _port = 0;
  private _host = '127.0.0.1';

  constructor(private options: TestSSHServerOptions = {}) {
    this.hostKey = generateHostKey();
    const keypair = ensureTestKeypair();
    this.authorizedKeyBlob = parseAuthorizedKeyBlob(keypair.authorizedKeysLine);
    this._clientPrivateKey = convertPkcs8ToSec1(keypair.privateKey);
  }

  /** Start the SSH server. Returns connection info once listening. */
  async start(): Promise<TestSSHServerInfo> {
    this._bareRepoPath = createBareRepo();
    this._tempDir = join(this._bareRepoPath, '..');

    return new Promise<TestSSHServerInfo>((resolve, reject) => {
      this.server = new SSHServer(
        { hostKeys: [this.hostKey] },
        (client: Connection) => {
          this.handleClient(client);
        },
      );

      this.server.on('error', (err: Error) => {
        reject(err);
      });

      const port = this.options.port ?? 0;
      const host = this.options.host ?? '127.0.0.1';

      this.server.listen(port, host, () => {
        const addr = this.server!.address();
        if (typeof addr === 'string' || !addr) {
          reject(new Error('Unexpected server address type'));
          return;
        }
        this._port = addr.port;
        this._host = host;

        resolve({
          port: this._port,
          host: this._host,
          bareRepoPath: this._bareRepoPath!,
          sshUrl: `ssh://test@${this._host}:${this._port}/repo.git`,
          clientPrivateKey: this._clientPrivateKey,
        });
      });
    });
  }

  /** Stop the SSH server and clean up the temporary bare repo. */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.cleanup();
          resolve();
        });
      } else {
        this.cleanup();
        resolve();
      }
    });
  }

  private cleanup(): void {
    if (this._tempDir) {
      rmSync(this._tempDir, { recursive: true, force: true });
      this._tempDir = null;
      this._bareRepoPath = null;
    }
    this.server = null;
  }

  get port(): number {
    return this._port;
  }

  get host(): string {
    return this._host;
  }

  get bareRepoPath(): string | null {
    return this._bareRepoPath;
  }

  private handleClient(client: Connection): void {
    client.on('authentication', (ctx: AuthContext) => {
      if (ctx.method === 'publickey') {
        const pkCtx = ctx as PublicKeyAuthContext;
        // Compare the client's key data against the authorized test key
        if (
          pkCtx.key.algo === 'ecdsa-sha2-nistp256' &&
          pkCtx.key.data.length === this.authorizedKeyBlob.length &&
          timingSafeEqual(pkCtx.key.data, this.authorizedKeyBlob)
        ) {
          ctx.accept();
        } else {
          ctx.reject();
        }
      } else if (ctx.method === 'none') {
        ctx.reject(['publickey']);
      } else {
        ctx.reject(['publickey']);
      }
    });

    client.on('ready', () => {
      client.on('session', (accept: AcceptConnection<Session>, reject: RejectConnection) => {
        const session = accept();
        this.handleSession(session);
      });
    });
  }

  private handleSession(session: Session): void {
    session.on('exec', (accept: AcceptConnection<ServerChannel>, reject: RejectConnection, info: ExecInfo) => {
      const channel = accept();
      const command = info.command;

      // Only allow git commands targeting the bare repo
      // Git over SSH typically runs: git-upload-pack '/path', git-receive-pack '/path'
      const gitCmdMatch = command.match(/^(git-upload-pack|git-receive-pack|git upload-pack|git receive-pack)\s+'?\/?repo\.git'?$/);
      if (!gitCmdMatch || !this._bareRepoPath) {
        channel.stderr.write(`Command not allowed: ${command}\n`);
        channel.exit(1);
        channel.close();
        return;
      }

      // Normalize: "git upload-pack" -> "git-upload-pack"
      const gitCmd = command.replace(/^git (upload-pack|receive-pack)/, 'git-$1').replace(/'?\/?repo\.git'?$/, '').trim();

      const child = spawn(gitCmd, [this._bareRepoPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe channel stdin to child stdin
      channel.on('data', (data: Buffer) => {
        child.stdin.write(data);
      });
      channel.on('end', () => {
        child.stdin.end();
      });

      // Pipe child stdout/stderr to channel
      child.stdout.on('data', (data: Buffer) => {
        channel.write(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        channel.stderr.write(data);
      });

      child.on('close', (code: number | null) => {
        channel.exit(code ?? 1);
        channel.close();
      });

      child.on('error', (err: Error) => {
        channel.stderr.write(`Error: ${err.message}\n`);
        channel.exit(1);
        channel.close();
      });
    });
  }
}

/**
 * Convenience: create, start, and return a test SSH server.
 * Call `server.stop()` when done.
 */
export async function startTestSSHServer(
  options?: TestSSHServerOptions,
): Promise<{ server: TestSSHServer; info: TestSSHServerInfo }> {
  const server = new TestSSHServer(options);
  const info = await server.start();
  return { server, info };
}
