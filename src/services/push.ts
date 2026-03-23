import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createLogger } from '../lib/logger.js';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<unknown>;
};

const log = createLogger('push');

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface StoredSubscription extends PushSubscription {
  createdAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushService {
  subscribe(sub: PushSubscription): Promise<void>;
  getSubscriptions(): StoredSubscription[];
  sendToAll(payload: PushPayload): Promise<void>;
  getVapidPublicKey(): string;
}

type SendNotificationFn = (sub: PushSubscription, payload: string) => Promise<void>;

export interface PushServiceOptions {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  subscriptionsPath: string;
  _sendNotification?: SendNotificationFn;
}

function loadSubscriptions(path: string): StoredSubscription[] {
  try {
    const raw = readFileSync(path, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredSubscription[];
  } catch {
    return [];
  }
}

function saveSubscriptions(path: string, subs: StoredSubscription[]): void {
  writeFileSync(path, JSON.stringify(subs, null, 2) + '\n', 'utf-8');
}

export function createPushService(opts: PushServiceOptions): PushService {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject, subscriptionsPath } = opts;

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let subscriptions = loadSubscriptions(subscriptionsPath);

  const sender: SendNotificationFn = opts._sendNotification ?? (async (sub, payload) => {
    await webpush.sendNotification(sub, payload);
  });

  return {
    async subscribe(sub: PushSubscription): Promise<void> {
      const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
      if (exists) return;

      const stored: StoredSubscription = {
        ...sub,
        createdAt: new Date().toISOString(),
      };
      subscriptions.push(stored);
      saveSubscriptions(subscriptionsPath, subscriptions);
      log.info({ endpoint: sub.endpoint }, 'Push subscription added');
    },

    getSubscriptions(): StoredSubscription[] {
      return [...subscriptions];
    },

    async sendToAll(payload: PushPayload): Promise<void> {
      if (subscriptions.length === 0) return;

      const payloadStr = JSON.stringify(payload);
      const expiredEndpoints: string[] = [];

      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await sender(sub, payloadStr);
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode;
            if (statusCode === 410 || statusCode === 404) {
              log.info({ endpoint: sub.endpoint, statusCode }, 'Removing expired push subscription');
              expiredEndpoints.push(sub.endpoint);
            } else {
              log.warn({ endpoint: sub.endpoint, err }, 'Failed to send push notification');
            }
          }
        })
      );

      if (expiredEndpoints.length > 0) {
        subscriptions = subscriptions.filter(s => !expiredEndpoints.includes(s.endpoint));
        saveSubscriptions(subscriptionsPath, subscriptions);
      }
    },

    getVapidPublicKey(): string {
      return vapidPublicKey;
    },
  };
}
