import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import {
  PERMISSION_CACHE_DEFAULT_TTL_SECONDS,
  PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS,
} from '@/shared/constants/ttl.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const PERMISSION_CACHE_PREFIX = 'perm';
const PERMISSION_CACHE_ORGANIZATION_VERSION_PREFIX = 'perm:org';
const STAMPEDE_POLL_MS = 50;
const STAMPEDE_POLL_ATTEMPTS = 40;

function buildOrganizationVersionKey(organizationId: string): string {
  return `${PERMISSION_CACHE_ORGANIZATION_VERSION_PREFIX}:${organizationId}:v`;
}

async function getOrganizationCacheVersion(organizationId: string): Promise<number> {
  try {
    const raw = await redisConnection.get(buildOrganizationVersionKey(organizationId));
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (error) {
    logger.warn({ error }, 'permission-cache.version.read.failed');
    return 0;
  }
}

/**
 * Build the Redis key for a user's organization permissions, scoped by the org cache version
 * so we can invalidate per-organization with a single INCR (no SCAN sweep).
 */
function buildKey(version: number, userId: string, organizationId: string): string {
  return `${PERMISSION_CACHE_PREFIX}:${version}:${userId}:${organizationId}`;
}

function buildRecomputeLockKey(userId: string, organizationId: string): string {
  return `${PERMISSION_CACHE_PREFIX}:lock:${userId}:${organizationId}`;
}

/**
 * Get cached permission codes for a user in an organization.
 * Returns null if not cached.
 *
 * @remarks
 * - **Algorithm:** reads the org cache version (defaulting to 0 if unset),
 *   then `GET`s the versioned key built by {@link buildKey} and `JSON.parse`s
 *   the value.
 * - **Failure modes:** Redis errors are caught, logged
 *   (`permission-cache.get.failed`), and surface as `null` so the caller
 *   falls back to a fresh database resolution.
 * - **Side effects:** none — read-only Redis lookups; never blocks the
 *   request path.
 * - **Notes:** versioned keys are why
 *   {@link invalidateOrganizationPermissions} can purge an entire org with a
 *   single `INCR` instead of a SCAN.
 */
export async function getCachedPermissions(
  userId: string,
  organizationId: string,
): Promise<string[] | null> {
  try {
    const version = await getOrganizationCacheVersion(organizationId);
    const cached = await redisConnection.get(buildKey(version, userId, organizationId));
    if (!cached) return null;
    return JSON.parse(cached) as string[];
  } catch (error) {
    logger.warn({ error }, 'permission-cache.get.failed');
    return null;
  }
}

/**
 * Cache permission codes for a user in an organization.
 *
 * @remarks
 * - **Algorithm:** reads the current org cache version and writes the JSON
 *   array under the versioned key with a TTL of
 *   `ttlSeconds + jitter (0..60s)` so a stampede of expirations is smeared
 *   across a minute.
 * - **Failure modes:** Redis errors are caught and logged
 *   (`permission-cache.set.failed`); the call resolves successfully so a
 *   cache write failure never blocks the request.
 * - **Side effects:** single Redis `SET ... EX` under `perm:<version>:...`.
 * - **Notes:** the default TTL is
 *   {@link PERMISSION_CACHE_DEFAULT_TTL_SECONDS} (5 minutes); callers
 *   typically rely on the default.
 */
export async function setCachedPermissions(
  userId: string,
  organizationId: string,
  codes: string[],
  ttlSeconds = PERMISSION_CACHE_DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    const version = await getOrganizationCacheVersion(organizationId);
    /** Small jitter so many users do not expire and recompute in the same second. */
    const jitterSeconds = Math.floor(Math.random() * 61);
    await redisConnection.set(
      buildKey(version, userId, organizationId),
      JSON.stringify(codes),
      'EX',
      ttlSeconds + jitterSeconds,
    );
  } catch (error) {
    logger.warn({ error }, 'permission-cache.set.failed');
  }
}

/**
 * Runs a cache-miss recompute under a short Redis lock. Waiters poll for the cached value
 * so only one request per (user, organization) hits the database during a stampede.
 *
 * @remarks
 * - **Algorithm:** `SET key 1 EX <ttl> NX` to claim the lock; on success
 *   runs `recompute()`, then calls {@link setCachedPermissions} and returns.
 *   Waiters poll up to `STAMPEDE_POLL_ATTEMPTS` × `STAMPEDE_POLL_MS` (≈2s)
 *   for the cache to populate; if still empty, they fall through to a fresh
 *   recompute as a safety net.
 * - **Failure modes:** Redis `SET` failure is logged
 *   (`permission-cache.lock.acquire.failed`) and the caller falls back to a
 *   direct `recompute()` without locking — the database carries the load.
 *   `recompute()` errors propagate to the caller.
 * - **Side effects:** Redis SET/DEL on `perm:lock:<user>:<org>`; one
 *   Postgres-hitting `recompute()` per stampede on the happy path; cache
 *   write through {@link setCachedPermissions}.
 * - **Notes:** the lock TTL is
 *   {@link PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS}; the lock is
 *   released in a `finally` block so an uncaught exception never strands it.
 */
export async function withPermissionCacheRecomputeLock(
  userId: string,
  organizationId: string,
  recompute: () => Promise<string[]>,
): Promise<string[]> {
  const lockKey = buildRecomputeLockKey(userId, organizationId);
  let acquiredLock = false;
  try {
    let lockResult: string | null;
    try {
      lockResult = await redisConnection.set(
        lockKey,
        '1',
        'EX',
        PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      logger.warn({ error }, 'permission-cache.lock.acquire.failed');
      return await recompute();
    }
    acquiredLock = lockResult === 'OK';

    if (!acquiredLock) {
      for (let attempt = 0; attempt < STAMPEDE_POLL_ATTEMPTS; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, STAMPEDE_POLL_MS));
        const waiterCached = await getCachedPermissions(userId, organizationId);
        if (waiterCached !== null) {
          return waiterCached;
        }
      }
    }

    const doubleCheck = await getCachedPermissions(userId, organizationId);
    if (doubleCheck !== null) {
      return doubleCheck;
    }

    const fresh = await recompute();
    await setCachedPermissions(userId, organizationId, fresh);
    return fresh;
  } finally {
    if (acquiredLock) {
      try {
        await redisConnection.del(lockKey);
      } catch (error) {
        logger.warn({ error }, 'permission-cache.lock.release.failed');
      }
    }
  }
}

/**
 * Invalidate cached permissions for a specific user in an organization.
 * Call this when roles/permissions change.
 *
 * @remarks
 * - **Algorithm:** issues a single Redis `DEL` for both the versioned cache
 *   entry and the recompute lock for `(user, organization)`.
 * - **Failure modes:** Redis errors are caught and logged
 *   (`permission-cache.invalidate.failed`); the function still resolves so
 *   callers (membership create/update) never block on cache invalidation.
 * - **Side effects:** Redis `DEL` of two keys.
 * - **Notes:** for org-wide changes (e.g. role-permission set replaced),
 *   prefer {@link invalidateOrganizationPermissions}, which bumps the org
 *   version with a single `INCR` and orphans every per-user key at once.
 */
export async function invalidatePermissions(userId: string, organizationId: string): Promise<void> {
  try {
    const version = await getOrganizationCacheVersion(organizationId);
    await redisConnection.del(
      buildKey(version, userId, organizationId),
      buildRecomputeLockKey(userId, organizationId),
    );
  } catch (error) {
    logger.warn({ error }, 'permission-cache.invalidate.failed');
  }
}

/**
 * Invalidate all cached permissions for an organization via INCR on the version key.
 *
 * No SCAN: existing keys are simply orphaned and expire via TTL, while new reads/writes
 * see the bumped version and operate on a fresh namespace.
 *
 * @remarks
 * - **Algorithm:** atomically bumps `perm:org:<org>:v` via Redis `INCR`. All
 *   subsequent reads/writes go through {@link buildKey} with the new version,
 *   so every previously cached entry for the org is instantly unreachable.
 * - **Failure modes:** Redis errors are caught and logged
 *   (`permission-cache.invalidate-organization.failed`); the function still
 *   resolves so callers (role/permission edits) never block on cache
 *   invalidation.
 * - **Side effects:** single Redis `INCR`; orphans existing keys which expire
 *   naturally via their TTL — keeps invalidation O(1).
 * - **Notes:** use this whenever a change can affect many users in the org
 *   (e.g. a role's permission set is replaced); per-user changes can use the
 *   narrower {@link invalidatePermissions}.
 */
export async function invalidateOrganizationPermissions(organizationId: string): Promise<void> {
  try {
    await redisConnection.incr(buildOrganizationVersionKey(organizationId));
  } catch (error) {
    logger.warn({ error }, 'permission-cache.invalidate-organization.failed');
  }
}
