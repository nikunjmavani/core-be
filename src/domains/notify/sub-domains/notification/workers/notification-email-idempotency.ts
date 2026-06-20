import type { Redis } from 'ioredis';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';

/** Redis key prefix for the one-time notification email-dispatch marker. */
const NOTIFICATION_EMAIL_DISPATCH_KEY_PREFIX = 'notification:email-dispatched:';

function buildKey(notificationId: number, recipient: string): string {
  return `${NOTIFICATION_EMAIL_DISPATCH_KEY_PREFIX}${notificationId}:${recipient.toLowerCase()}`;
}

/**
 * Reads whether a notification email was already durably dispatched (audit-#7).
 *
 * @remarks
 * - **Algorithm:** `GET key` → marker present means a prior run already persisted the mail-outbox
 *   row, so this run must skip to avoid a duplicate send.
 * - **Failure modes:** Redis errors propagate so the job retries rather than risking a double send.
 * - **Side effects:** none (read-only).
 * - **Notes:** paired with {@link markNotificationEmailDispatched}, which is written ONLY AFTER the
 *   durable outbox insert. This is the durability-first replacement for the claim-before-insert
 *   model that could lose an email on a crash between the claim and the insert.
 */
export async function isNotificationEmailDispatched(options: {
  notificationId: number;
  recipient: string;
  redis?: Redis;
}): Promise<boolean> {
  const { notificationId, recipient } = options;
  const redis = options.redis ?? redisConnection;
  const result = await redis.get(buildKey(notificationId, recipient));
  return result !== null;
}

/**
 * Marks a notification email as durably dispatched (audit-#7) — written only after the
 * mail-outbox row is persisted.
 *
 * @remarks
 * - **Algorithm:** `SET key 1 EX <ttl>` (no `NX`: the post-insert marker is set unconditionally
 *   so the dedup window survives concurrent runs converging on the same notification).
 * - **Failure modes:** Redis errors propagate; the durable outbox row already exists, so the
 *   mail-outbox sweeper still dispatches it even if marking fails.
 * - **Side effects:** writes a short-lived Redis key.
 * - **Notes:** because the marker is set AFTER the durable insert, a hard crash between the
 *   insert and this call can cause a rare duplicate on retry — an at-least-once trade chosen
 *   because a lost notification is worse than a rare duplicate.
 */
export async function markNotificationEmailDispatched(options: {
  notificationId: number;
  recipient: string;
  redis?: Redis;
}): Promise<void> {
  const { notificationId, recipient } = options;
  const redis = options.redis ?? redisConnection;
  await redis.set(
    buildKey(notificationId, recipient),
    '1',
    'EX',
    NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS,
  );
}
