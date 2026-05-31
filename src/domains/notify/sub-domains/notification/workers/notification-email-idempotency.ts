import type { Redis } from 'ioredis';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';

/** Redis key prefix for the one-time notification email-dispatch marker. */
const NOTIFICATION_EMAIL_DISPATCH_KEY_PREFIX = 'notification:email-dispatched:';

function buildKey(notificationId: number, recipient: string): string {
  return `${NOTIFICATION_EMAIL_DISPATCH_KEY_PREFIX}${notificationId}:${recipient.toLowerCase()}`;
}

/**
 * Atomically claims the one-time email-dispatch slot for a `notificationId` + recipient pair.
 *
 * @remarks
 * - **Algorithm:** `SET key 1 EX <ttl> NX` — only the first caller observes `OK` and may enqueue
 *   the email; later callers (BullMQ retries of the same notification job) observe `null` and skip.
 * - **Failure modes:** Redis errors propagate so the job retries rather than silently sending.
 * - **Side effects:** writes a short-lived Redis key.
 * - **Notes:** the marker is released via {@link releaseNotificationEmailDispatch} when the
 *   dispatch that won the claim subsequently fails, so a retry can re-claim and actually send —
 *   the marker is only retained once an email has been successfully enqueued.
 */
export async function claimNotificationEmailDispatch(options: {
  notificationId: number;
  recipient: string;
  redis?: Redis;
}): Promise<boolean> {
  const { notificationId, recipient } = options;
  const redis = options.redis ?? redisConnection;
  const result = await redis.set(
    buildKey(notificationId, recipient),
    '1',
    'EX',
    NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS,
    'NX',
  );
  return result === 'OK';
}

/**
 * Releases a previously claimed email-dispatch slot so a failed dispatch can be retried.
 *
 * @remarks
 * - **Algorithm:** `DEL key`.
 * - **Failure modes:** Redis errors propagate to the caller.
 * - **Side effects:** removes the Redis marker written by {@link claimNotificationEmailDispatch}.
 * - **Notes:** call this only when the dispatch that won the claim failed before the email was
 *   durably enqueued, otherwise the at-most-once guarantee is lost.
 */
export async function releaseNotificationEmailDispatch(options: {
  notificationId: number;
  recipient: string;
  redis?: Redis;
}): Promise<void> {
  const { notificationId, recipient } = options;
  const redis = options.redis ?? redisConnection;
  await redis.del(buildKey(notificationId, recipient));
}
