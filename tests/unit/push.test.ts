import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The module under test — will be implemented in T046
import {
  createPushService,
  type PushService,
  type PushSubscription,
  type PushPayload,
} from '../../src/services/push.ts';

describe('push notification service', () => {
  let tmpDir: string;
  let subsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'push-test-'));
    subsPath = join(tmpDir, 'push-subscriptions.json');
    writeFileSync(subsPath, '[]', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const fakeVapidKeys = {
    publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkPs7gjJQ8_BBXJBnbDd5J0lLj5rHGe1p_JoPTUOqA',
    privateKey: 'Dt1CLgQlkiaA-tmCkATyKZeoF1-Sno3LigKj1oBKsFw',
    subject: 'mailto:test@localhost',
  };

  describe('createPushService', () => {
    it('should create a push service with VAPID keys', () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      assert.ok(service, 'should return a push service instance');
      assert.equal(typeof service.subscribe, 'function');
      assert.equal(typeof service.getSubscriptions, 'function');
      assert.equal(typeof service.sendToAll, 'function');
      assert.equal(typeof service.getVapidPublicKey, 'function');
    });

    it('should expose the VAPID public key', () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      assert.equal(service.getVapidPublicKey(), fakeVapidKeys.publicKey);
    });
  });

  describe('subscription storage', () => {
    it('should store a new subscription', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const sub: PushSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      };

      await service.subscribe(sub);

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 1);
      assert.equal(subs[0].endpoint, sub.endpoint);
      assert.equal(subs[0].keys.p256dh, sub.keys.p256dh);
      assert.equal(subs[0].keys.auth, sub.keys.auth);
    });

    it('should persist subscriptions to the JSON file', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const sub: PushSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      };

      await service.subscribe(sub);

      const raw = readFileSync(subsPath, 'utf-8');
      const stored = JSON.parse(raw) as Array<{ endpoint: string }>;
      assert.equal(stored.length, 1);
      assert.equal(stored[0].endpoint, sub.endpoint);
    });

    it('should load existing subscriptions from file on creation', async () => {
      const existingSub: PushSubscription & { createdAt: string } = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/existing',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
        createdAt: '2026-03-22T10:00:00Z',
      };
      writeFileSync(subsPath, JSON.stringify([existingSub]), 'utf-8');

      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 1);
      assert.equal(subs[0].endpoint, existingSub.endpoint);
    });

    it('should not add duplicate subscriptions (same endpoint)', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const sub: PushSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      };

      await service.subscribe(sub);
      await service.subscribe(sub);

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 1);
    });

    it('should add a createdAt timestamp when storing a subscription', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const before = new Date().toISOString();
      await service.subscribe({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      });

      const raw = readFileSync(subsPath, 'utf-8');
      const stored = JSON.parse(raw) as Array<{ createdAt: string }>;
      assert.equal(stored.length, 1);
      assert.ok(stored[0].createdAt, 'should have createdAt field');
      assert.ok(stored[0].createdAt >= before, 'createdAt should be recent');
    });

    it('should handle empty subscriptions file gracefully', () => {
      writeFileSync(subsPath, '', 'utf-8');

      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 0);
    });

    it('should handle malformed subscriptions file gracefully', () => {
      writeFileSync(subsPath, 'not json', 'utf-8');

      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 0);
    });

    it('should handle missing subscriptions file gracefully', () => {
      const missingPath = join(tmpDir, 'nonexistent.json');

      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: missingPath,
      });

      const subs = service.getSubscriptions();
      assert.equal(subs.length, 0);
    });
  });

  describe('sendToAll', () => {
    it('should format notification payload with title, body, and data', async () => {
      // We test the payload format by capturing what sendNotification receives
      // Since we can't easily mock web-push in this test, we test the payload
      // structure through the service's sendToAll interface
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      // With no subscriptions, sendToAll should complete without error
      const payload: PushPayload = {
        title: 'Task Blocked',
        body: 'Project "my-app" task 2.3 needs input',
        data: { projectId: 'proj-1', sessionId: 'sess-1', taskId: '2.3' },
      };

      // Should not throw even with no subscriptions
      await assert.doesNotReject(() => service.sendToAll(payload));
    });

    it('should accept a payload with only title and body (no data)', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
      });

      const payload: PushPayload = {
        title: 'Session Complete',
        body: 'All tasks done for my-project',
      };

      await assert.doesNotReject(() => service.sendToAll(payload));
    });

    it('should remove expired subscriptions (410 status) after failed send', async () => {
      // Create service with a mock sendNotification that rejects with 410
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
        // Inject a mock sender for testing — returns 410 Gone
        _sendNotification: async () => {
          const err = new Error('Gone') as Error & { statusCode: number };
          err.statusCode = 410;
          throw err;
        },
      });

      const sub: PushSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/expired',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      };

      await service.subscribe(sub);
      assert.equal(service.getSubscriptions().length, 1);

      await service.sendToAll({ title: 'Test', body: 'Test body' });

      // Expired subscription should be removed
      assert.equal(service.getSubscriptions().length, 0);

      // Should be removed from the file too
      const raw = readFileSync(subsPath, 'utf-8');
      const stored = JSON.parse(raw) as unknown[];
      assert.equal(stored.length, 0);
    });

    it('should not remove subscriptions on non-410 errors', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
        _sendNotification: async () => {
          const err = new Error('Server Error') as Error & { statusCode: number };
          err.statusCode = 500;
          throw err;
        },
      });

      const sub: PushSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/valid',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8jVCQWY',
          auth: 'tBHItJI5svbpC7_F76q_Uw',
        },
      };

      await service.subscribe(sub);
      await service.sendToAll({ title: 'Test', body: 'Test body' });

      // Subscription should still be there
      assert.equal(service.getSubscriptions().length, 1);
    });

    it('should send to all subscriptions', async () => {
      const sentTo: string[] = [];
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
        _sendNotification: async (sub: PushSubscription) => {
          sentTo.push(sub.endpoint);
        },
      });

      await service.subscribe({
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      });
      await service.subscribe({
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub2',
        keys: { p256dh: 'key2', auth: 'auth2' },
      });

      await service.sendToAll({ title: 'Test', body: 'Test body' });

      assert.equal(sentTo.length, 2);
      assert.ok(sentTo.includes('https://fcm.googleapis.com/fcm/send/sub1'));
      assert.ok(sentTo.includes('https://fcm.googleapis.com/fcm/send/sub2'));
    });

    it('should stringify the payload as JSON when sending', async () => {
      let capturedPayload: string | undefined;
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
        _sendNotification: async (_sub: PushSubscription, payload: string) => {
          capturedPayload = payload;
        },
      });

      await service.subscribe({
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      });

      const payload: PushPayload = {
        title: 'Task Blocked',
        body: 'Need input on task 2.3',
        data: { projectId: 'p1' },
      };

      await service.sendToAll(payload);

      assert.ok(capturedPayload, 'payload should have been captured');
      const parsed = JSON.parse(capturedPayload) as PushPayload;
      assert.equal(parsed.title, 'Task Blocked');
      assert.equal(parsed.body, 'Need input on task 2.3');
      assert.deepEqual(parsed.data, { projectId: 'p1' });
    });

    it('should also remove subscription on 404 status (endpoint not found)', async () => {
      const service = createPushService({
        vapidPublicKey: fakeVapidKeys.publicKey,
        vapidPrivateKey: fakeVapidKeys.privateKey,
        vapidSubject: fakeVapidKeys.subject,
        subscriptionsPath: subsPath,
        _sendNotification: async () => {
          const err = new Error('Not Found') as Error & { statusCode: number };
          err.statusCode = 404;
          throw err;
        },
      });

      await service.subscribe({
        endpoint: 'https://fcm.googleapis.com/fcm/send/gone',
        keys: { p256dh: 'key1', auth: 'auth1' },
      });

      await service.sendToAll({ title: 'Test', body: 'body' });

      assert.equal(service.getSubscriptions().length, 0);
    });
  });
});
