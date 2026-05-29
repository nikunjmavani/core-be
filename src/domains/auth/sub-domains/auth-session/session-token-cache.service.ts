import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { SESSION_TOKEN_CACHE_TTL_SECONDS } from '@/shared/constants/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const SESSION_TOKEN_CACHE_PREFIX = 'session:tok';

function buildSessionTokenCacheKey(tokenHash: string): string {
  return `${SESSION_TOKEN_CACHE_PREFIX}:${tokenHash}`;
}

/**
 * Returns true when the token hash was recently validated against an active session.
 *
 * @remarks
 * - **Algorithm:** Redis `GET session:tok:<hash>`; presence of the sentinel `'1'` means the
 *   bearer was confirmed active within {@link SESSION_TOKEN_CACHE_TTL_SECONDS}.
 * - **Failure modes:** Redis failures are logged and swallowed — the function returns
 *   `false` so the caller falls back to the database (fail-open on availability,
 *   fail-closed on staleness because the DB is the source of truth).
 * - **Side effects:** read-only Redis lookup.
 * - **Notes:** consumed by {@link AuthSessionService.verifyActiveAccessToken} to skip the
 *   `sessions` query on hot bearer-auth paths.
 */
export async function getCachedSessionTokenValid(tokenHash: string): Promise<boolean> {
  try {
    const cached = await redisConnection.get(buildSessionTokenCacheKey(tokenHash));
    return cached === '1';
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.get.failed');
    return false;
  }
}

/**
 * Input for {@link setCachedSessionTokenValid}: the token hash to cache plus the backing session's expiry, used to bound the cache TTL so it can never outlive the session.
 *
 * @remarks
 * - **Algorithm:** `sessionExpiresAt` is the authoritative session expiry from Postgres; the
 *   caller derives the cache TTL as `min(SESSION_TOKEN_CACHE_TTL_SECONDS, expires_at - now)`.
 * - **Failure modes:** none — this is a plain data carrier with no behavior.
 * - **Side effects:** none.
 * - **Notes:** `tokenHash` is the hashed access token (never the raw bearer); pairing it with
 *   `sessionExpiresAt` is what prevents a cached "valid" sentinel from outliving the session.
 */
export interface SetCachedSessionTokenValidInput {
  tokenHash: string;
  sessionExpiresAt: Date;
}

/**
 * Marks a token hash as a recently validated active session in Redis, capped to the session lifetime.
 *
 * @remarks
 * - **Algorithm:** `SETEX session:tok:<hash> 1 <ttl>` where `ttl =
 *   min(SESSION_TOKEN_CACHE_TTL_SECONDS, floor((sessionExpiresAt - now) / 1000))`.
 *   Bounding by the remaining session lifetime ensures the cached "valid" sentinel
 *   can never outlive the session itself — a token validated just before expiry is
 *   no longer accepted once the session actually expires. When the bounded TTL is
 *   `<= 0` (session already expired or expiring within the current second) nothing
 *   is cached and the next check falls back to Postgres.
 * - **Failure modes:** Redis errors are logged and swallowed; the caller's request
 *   succeeds even when caching is unavailable.
 * - **Side effects:** writes a single short-lived Redis entry (or none when the
 *   bounded TTL is non-positive).
 * - **Notes:** the cache is invalidated on every revoke or rotate via
 *   {@link invalidateCachedSessionToken} to bound staleness to that TTL.
 */
export async function setCachedSessionTokenValid({
  tokenHash,
  sessionExpiresAt,
}: SetCachedSessionTokenValidInput): Promise<void> {
  const remainingSeconds = Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000);
  const ttlSeconds = Math.min(SESSION_TOKEN_CACHE_TTL_SECONDS, remainingSeconds);
  if (ttlSeconds <= 0) {
    return;
  }
  try {
    await redisConnection.set(buildSessionTokenCacheKey(tokenHash), '1', 'EX', ttlSeconds);
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.set.failed');
  }
}

/**
 * Drops the cached "valid bearer" sentinel for a token hash so subsequent calls re-check Postgres.
 *
 * @remarks
 * - **Algorithm:** Redis `DEL session:tok:<hash>`.
 * - **Failure modes:** Redis errors are logged and swallowed — staleness is bounded by
 *   the original `SETEX` TTL even if the delete is lost.
 * - **Side effects:** removes a Redis key.
 * - **Notes:** must be called on session revoke (single + bulk) and on every token-hash
 *   rotation so newly-rotated JWTs don't read a stale cache entry.
 */
export async function invalidateCachedSessionToken(tokenHash: string): Promise<void> {
  try {
    await redisConnection.del(buildSessionTokenCacheKey(tokenHash));
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.invalidate.failed');
  }
}
