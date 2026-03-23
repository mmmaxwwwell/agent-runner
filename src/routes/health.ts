import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import type { Config } from '../lib/config.js';
import { setLevel, getLevel } from '../lib/logger.js';
import type { LogLevel } from '../lib/config.js';

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error', 'fatal']);

const startTime = Date.now();

let sandboxAvailable: boolean | null = null;

function checkSandboxAvailable(): boolean {
  if (sandboxAvailable !== null) return sandboxAvailable;
  try {
    execFileSync('systemd-run', ['--version'], { stdio: 'ignore' });
    sandboxAvailable = true;
  } catch {
    sandboxAvailable = false;
  }
  return sandboxAvailable;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;

export function mountHealthRoutes(apiRoutes: Map<string, RouteHandler>, cfg: Config): void {
  apiRoutes.set('GET /api/health', (_req, res) => {
    sendJson(res, 200, {
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      sandboxAvailable: checkSandboxAvailable(),
      cloudSttAvailable: cfg.googleSttApiKey !== null,
    });
  });

  apiRoutes.set('PUT /api/config/log-level', (req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { level?: string };
        if (!parsed.level || !LOG_LEVELS.has(parsed.level)) {
          sendJson(res, 400, { error: `Invalid level. Must be one of: ${[...LOG_LEVELS].join(', ')}` });
          return;
        }
        setLevel(parsed.level as LogLevel);
        sendJson(res, 200, { level: getLevel() });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  });
}
