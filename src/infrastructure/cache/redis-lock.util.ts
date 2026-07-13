import { randomUUID } from 'node:crypto';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Releases the lock only when its value still matches our nonce (compare-and-del), so we never delete a lock re-acquired by another holder after our TTL lapsed. */
const REDIS_LOCK_RELEASE_IF_HELD_LUA =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0";

/**
 * Thrown by {@link withRedisLock} when the lock could not be acquired within `waitTimeoutMs`.
 *
 * @remarks
 * Callers translate this to a domain-appropriate response (e.g. a `409` "operation already in
 * progress"). It signals contention, NOT a Redis outage — a Redis error while acquiring propagates
 * as the underlying error instead.
 */
export class RedisLockUnavailableError extends Error {
  constructor(public readonly lockKey: string) {
    super(`redis lock unavailable: ${lockKey}`);
    this.name = 'RedisLockUnavailableError';
  }
}

/** Options for {@link withRedisLock}. */
export interface RedisLockOptions {
  /** Fully-qualified Redis key for the lock (caller owns the namespace). */
  key: string;
  /** Lock TTL in seconds — MUST exceed the maximum runtime of `fn` (incl. any external call it makes) so the lock never lapses mid-critical-section. Auto-expires if the holder crashes. */
  ttlSeconds: number;
  /** Max time to wait (ms) for a contended lock before throwing {@link RedisLockUnavailableError}. `0` (default) fails fast. */
  waitTimeoutMs?: number;
  /** Poll interval (ms) while waiting for a contended lock. */
  pollIntervalMs?: number;
}

/**
 * Runs `fn` while holding a best-effort distributed lock on `options.key`.
 *
 * @remarks
 * - **Algorithm:** `SET key <nonce> EX <ttl> NX` to claim the lock; on contention it polls every
 *   `pollIntervalMs` until acquired or `waitTimeoutMs` elapses. Runs `fn`, then releases the lock in
 *   a `finally` via a nonce-guarded compare-and-del Lua so a lock re-acquired after a TTL lapse is
 *   never deleted by the wrong holder.
 * - **Failure modes:** throws {@link RedisLockUnavailableError} when the lock stays contended past
 *   `waitTimeoutMs`; a Redis error during acquire propagates unchanged; `fn`'s errors propagate after
 *   the lock is released.
 * - **Side effects:** `SET`/`EVAL` on Redis; whatever `fn` does.
 * - **Notes:** this is a *best-effort* serializer, not a correctness boundary — a TTL lapse or Redis
 *   outage can let two holders run concurrently, so the critical section must still be correct under
 *   a durable backstop (a unique index, idempotency key, etc.). It only reduces duplicate work /
 *   churn in the common case.
 */
export async function withRedisLock<T>(
  options: RedisLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const { key, ttlSeconds, waitTimeoutMs = 0, pollIntervalMs = 50 } = options;
  const nonce = randomUUID();
  const deadline = Date.now() + waitTimeoutMs;
  let acquired = false;

  do {
    const result = await redisConnection.set(key, nonce, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      acquired = true;
      break;
    }
    if (waitTimeoutMs <= 0) {
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);

  if (!acquired) {
    throw new RedisLockUnavailableError(key);
  }

  try {
    return await fn();
  } finally {
    try {
      await redisConnection.eval(REDIS_LOCK_RELEASE_IF_HELD_LUA, 1, key, nonce);
    } catch (error) {
      logger.warn({ error, key }, 'redis-lock.release.failed');
    }
  }
}
