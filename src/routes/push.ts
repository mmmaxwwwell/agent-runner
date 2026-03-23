import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../lib/config.js';
import type { PushService } from '../services/push.js';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function mountPushRoutes(apiRoutes: Map<string, RouteHandler>, cfg: Config, pushService: PushService): void {
  // POST /api/push/subscribe — store a push subscription
  apiRoutes.set('POST /api/push/subscribe', async (req, res) => {
    const raw = await readBody(req);
    let parsed: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!parsed.endpoint || typeof parsed.endpoint !== 'string') {
      sendJson(res, 400, { error: 'Missing or invalid "endpoint" field' });
      return;
    }
    if (!parsed.keys || typeof parsed.keys.p256dh !== 'string' || typeof parsed.keys.auth !== 'string') {
      sendJson(res, 400, { error: 'Missing or invalid "keys" field (requires p256dh and auth)' });
      return;
    }

    await pushService.subscribe({
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
    });

    res.writeHead(201);
    res.end();
  });

  // GET /api/push/vapid-key — return the VAPID public key
  apiRoutes.set('GET /api/push/vapid-key', (_req, res) => {
    sendJson(res, 200, { publicKey: pushService.getVapidPublicKey() });
  });
}
