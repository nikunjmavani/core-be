import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNotificationEmailDispatched,
  markNotificationEmailDispatched,
} from '@/domains/notify/sub-domains/notification/workers/notification-email-idempotency.js';
import { NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';

/**
 * The guard that stops a retried notification job from emailing the same user twice (audit-#7).
 *
 * Both helpers accept an injected `redis` handle, so these cases drive a small in-memory double
 * rather than mocking the module graph.
 *
 * The critical property is the *direction* of the failure mode: a Redis error must propagate so
 * BullMQ retries, and must never be swallowed into a `true` ("already dispatched") answer — that
 * would silently drop the email entirely, which is the failure this guard exists to prevent.
 */
describe('notification email dispatch idempotency', () => {
  interface StoredValue {
    value: string;
    ttlSeconds: number | null;
  }

  let store: Map<string, StoredValue>;
  let redis: Redis;

  function createRedisDouble(): Redis {
    return {
      get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
      set: vi.fn(async (key: string, value: string, mode?: string, ttlSeconds?: number) => {
        store.set(key, {
          value,
          ttlSeconds: mode === 'EX' && typeof ttlSeconds === 'number' ? ttlSeconds : null,
        });
        return 'OK';
      }),
    } as unknown as Redis;
  }

  beforeEach(() => {
    store = new Map();
    redis = createRedisDouble();
  });

  it('reports not-dispatched for a notification that was never marked', () => {
    return expect(
      isNotificationEmailDispatched({
        notificationId: 1,
        recipient: 'user@example.com',
        redis,
      }),
    ).resolves.toBe(false);
  });

  it('reports dispatched once the notification has been marked', async () => {
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'user@example.com',
      redis,
    });

    await expect(
      isNotificationEmailDispatched({
        notificationId: 1,
        recipient: 'user@example.com',
        redis,
      }),
    ).resolves.toBe(true);
  });

  it('scopes the marker to the notification id and recipient', async () => {
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'user@example.com',
      redis,
    });

    // A different notification to the same recipient, and the same notification to a different
    // recipient, must both still be undispatched — the key is the pair, not either half.
    await expect(
      isNotificationEmailDispatched({ notificationId: 2, recipient: 'user@example.com', redis }),
    ).resolves.toBe(false);
    await expect(
      isNotificationEmailDispatched({ notificationId: 1, recipient: 'other@example.com', redis }),
    ).resolves.toBe(false);
  });

  it('treats the recipient case-insensitively', async () => {
    // buildKey lowercases the recipient, so a re-queued job whose payload carries a differently
    // cased address must not be read as a fresh dispatch.
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'User@Example.COM',
      redis,
    });

    await expect(
      isNotificationEmailDispatched({ notificationId: 1, recipient: 'user@example.com', redis }),
    ).resolves.toBe(true);
  });

  it('marking twice is idempotent and leaves a single marker', async () => {
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'user@example.com',
      redis,
    });
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'user@example.com',
      redis,
    });

    expect(store.size).toBe(1);
    await expect(
      isNotificationEmailDispatched({ notificationId: 1, recipient: 'user@example.com', redis }),
    ).resolves.toBe(true);
  });

  it('writes the marker with the declared TTL so the dedup window expires', async () => {
    await markNotificationEmailDispatched({
      notificationId: 1,
      recipient: 'user@example.com',
      redis,
    });

    const [stored] = [...store.values()];
    expect(stored?.ttlSeconds).toBe(NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS);
    // A marker without a TTL would pin one key per notification in Redis forever.
    expect(stored?.ttlSeconds).not.toBeNull();
  });

  it('propagates a Redis read failure instead of reporting "already dispatched"', async () => {
    // The dangerous swallow: returning true on error would skip the send and lose the email.
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    } as unknown as Redis;

    await expect(
      isNotificationEmailDispatched({
        notificationId: 1,
        recipient: 'user@example.com',
        redis: failingRedis,
      }),
    ).rejects.toThrow('redis unavailable');
  });

  it('propagates a Redis write failure so the job retries', async () => {
    const failingRedis = {
      set: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    } as unknown as Redis;

    await expect(
      markNotificationEmailDispatched({
        notificationId: 1,
        recipient: 'user@example.com',
        redis: failingRedis,
      }),
    ).rejects.toThrow('redis unavailable');
  });
});
