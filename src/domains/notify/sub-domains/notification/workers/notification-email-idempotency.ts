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
