import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error', 'fatal']);

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  projectsDir: string;
  logLevel: LogLevel;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  allowUnsandboxed: boolean;
  googleSttApiKey: string | null;
  diskWarnThresholdMb: number;
}

function resolveDataDir(): string {
  const envVal = process.env['AGENT_RUNNER_DATA_DIR'];
  if (envVal) {
    return resolve(envVal.replace(/^~/, homedir()));
  }
  return resolve(homedir(), '.agent-runner');
}

function loadVapidKeysFromFile(dataDir: string): VapidKeys | null {
  const vapidPath = resolve(dataDir, 'vapid-keys.json');
  if (!existsSync(vapidPath)) return null;
  try {
    const content = readFileSync(vapidPath, 'utf-8');
    const parsed = JSON.parse(content) as { publicKey?: string; privateKey?: string };
    if (parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
    return null;
  } catch {
    return null;
  }
}

function generateAndSaveVapidKeys(dataDir: string): VapidKeys {
  const require = createRequire(import.meta.url);
  const webPush = require('web-push') as { generateVAPIDKeys: () => VapidKeys };
  const keys = webPush.generateVAPIDKeys();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    resolve(dataDir, 'vapid-keys.json'),
    JSON.stringify(keys, null, 2) + '\n',
    'utf-8'
  );
  return keys;
}

function resolveVapidKeys(dataDir: string): VapidKeys {
  // Env vars take precedence
  const envPublic = process.env['VAPID_PUBLIC_KEY'];
  const envPrivate = process.env['VAPID_PRIVATE_KEY'];
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate };
  }

  // Try file
  const fileKeys = loadVapidKeysFromFile(dataDir);
  if (fileKeys) return fileKeys;

  // Auto-generate
  return generateAndSaveVapidKeys(dataDir);
}

export function loadConfig(): Config {
  const dataDir = resolveDataDir();
  const vapidKeys = resolveVapidKeys(dataDir);

  const projectsDir = process.env['AGENT_RUNNER_PROJECTS_DIR'] ?? '~/git';

  const logLevel = process.env['LOG_LEVEL'] ?? 'info';
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL "${logLevel}". Must be one of: ${[...LOG_LEVELS].join(', ')}`);
  }

  const portStr = process.env['AGENT_RUNNER_PORT'] ?? '3000';
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid AGENT_RUNNER_PORT "${portStr}". Must be a number between 0 and 65535`);
  }

  const diskThresholdStr = process.env['DISK_WARN_THRESHOLD_MB'] ?? '8192';
  const diskWarnThresholdMb = parseInt(diskThresholdStr, 10);
  if (isNaN(diskWarnThresholdMb) || diskWarnThresholdMb < 0) {
    throw new Error(`Invalid DISK_WARN_THRESHOLD_MB "${diskThresholdStr}". Must be a non-negative number`);
  }

  return {
    host: process.env['AGENT_RUNNER_HOST'] ?? '127.0.0.1',
    port,
    dataDir: resolve(dataDir),
    projectsDir: resolve(projectsDir.replace(/^~/, homedir())),
    logLevel: logLevel as LogLevel,
    vapidPublicKey: vapidKeys.publicKey,
    vapidPrivateKey: vapidKeys.privateKey,
    vapidSubject: process.env['VAPID_SUBJECT'] ?? 'mailto:agent-runner@localhost',
    allowUnsandboxed: process.env['ALLOW_UNSANDBOXED'] === 'true',
    googleSttApiKey: process.env['GOOGLE_STT_API_KEY'] ?? null,
    diskWarnThresholdMb,
  };
}
