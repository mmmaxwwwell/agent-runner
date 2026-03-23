import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, type Config } from './lib/config.js';
import { createLogger, setLevel } from './lib/logger.js';
import { mountHealthRoutes } from './routes/health.js';
import { mountProjectRoutes } from './routes/projects.js';
import { mountSessionRoutes } from './routes/sessions.js';
import { handleSessionStream, initSessionStream } from './ws/session-stream.js';
import { handleDashboard } from './ws/dashboard.js';

const log = createLogger('server');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PUBLIC_DIR = resolve(import.meta.dirname, '..', 'public');

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function serveStaticFile(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;

  // Prevent directory traversal
  const resolved = resolve(PUBLIC_DIR, '.' + filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return false;
  }

  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) return false;

    const content = await readFile(resolved);
    const ext = extname(resolved);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/** Route map for API handlers. Populated by mount functions in later tasks. */
export const apiRoutes: Map<string, (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>> = new Map();

function matchRoute(method: string, pathname: string): { handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>; params: Record<string, string> } | null {
  const key = `${method} ${pathname}`;

  // Exact match first
  const exact = apiRoutes.get(key);
  if (exact) return { handler: exact, params: {} };

  // Parameterized match
  for (const [pattern, handler] of apiRoutes) {
    const [patternMethod, patternPath] = pattern.split(' ', 2);
    if (patternMethod !== method) continue;

    const patternParts = patternPath!.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i]!;
      if (pp.startsWith(':')) {
        params[pp.slice(1)] = pathParts[i]!;
      } else if (pp !== pathParts[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }

  return null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const method = req.method ?? 'GET';
  const pathname = url.pathname;

  // API routes
  if (pathname.startsWith('/api/')) {
    const route = matchRoute(method, pathname);
    if (route) {
      try {
        await route.handler(req, res, route.params);
      } catch (err) {
        log.error({ err, method, pathname }, 'Unhandled error in API route');
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal server error' });
        }
      }
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // Static files
  const served = await serveStaticFile(req, res);
  if (!served) {
    // SPA fallback: serve index.html for non-API, non-file routes
    try {
      const indexPath = join(PUBLIC_DIR, 'index.html');
      const content = await readFile(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }
}

async function initDataDir(cfg: Config): Promise<void> {
  const initLog = createLogger('server');

  // Ensure data directory and sessions/ subdirectory exist
  await mkdir(join(cfg.dataDir, 'sessions'), { recursive: true });
  initLog.debug({ dataDir: cfg.dataDir }, 'Data directory ensured');

  // Ensure projects.json exists (empty array if missing)
  const projectsPath = join(cfg.dataDir, 'projects.json');
  try {
    await access(projectsPath);
  } catch {
    await writeFile(projectsPath, '[]\n', 'utf-8');
    initLog.info({ path: projectsPath }, 'Created empty projects.json');
  }

  // Ensure push-subscriptions.json exists (empty array if missing)
  const pushSubsPath = join(cfg.dataDir, 'push-subscriptions.json');
  try {
    await access(pushSubsPath);
  } catch {
    await writeFile(pushSubsPath, '[]\n', 'utf-8');
    initLog.info({ path: pushSubsPath }, 'Created empty push-subscriptions.json');
  }
}

const config = loadConfig();
setLevel(config.logLevel);

const server = createServer(handleRequest);

// WebSocket server (noServer mode — we handle upgrades manually)
const wss = new WebSocketServer({ noServer: true });

// Session stream path pattern: /ws/sessions/:id
const WS_SESSION_RE = /^\/ws\/sessions\/([a-f0-9-]+)$/;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const pathname = url.pathname;
  log.debug({ pathname }, 'WebSocket upgrade request');

  // Route: /ws/sessions/:id
  const sessionMatch = pathname.match(WS_SESSION_RE);
  if (sessionMatch) {
    const sessionId = sessionMatch[1]!;
    const lastSeqParam = url.searchParams.get('lastSeq');
    const lastSeq = lastSeqParam !== null ? parseInt(lastSeqParam, 10) : null;

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSessionStream(ws, req, sessionId, Number.isNaN(lastSeq) ? null : lastSeq);
    });
    return;
  }

  // Route: /ws/dashboard
  if (pathname === '/ws/dashboard') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleDashboard(ws, req);
    });
    return;
  }

  // Unknown WebSocket path — reject
  log.warn({ pathname }, 'Unknown WebSocket path, rejecting upgrade');
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

await initDataDir(config);
initSessionStream(config.dataDir);
mountHealthRoutes(apiRoutes, config);
mountProjectRoutes(apiRoutes, config);
mountSessionRoutes(apiRoutes, config);

server.listen(config.port, config.host, () => {
  log.info({
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
    logLevel: config.logLevel,
  }, 'Agent Runner server started');
});

export { server, config };
