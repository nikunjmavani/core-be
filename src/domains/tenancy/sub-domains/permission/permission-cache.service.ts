import { randomUUID } from 'node:crypto';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { PERMISSION_CACHE_STAMPEDE_POLL_MS } from '@/shared/constants/limits.constants.js';
import {
  PERMISSION_CACHE_DEFAULT_TTL_SECONDS,
  PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS,
} from '@/shared/constants/ttl.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const PERMISSION_CACHE_PREFIX = 'perm';
const PERMISSION_CACHE_ORGANIZATION_VERSION_PREFIX = 'perm:org';
const STAMPEDE_POLL_ATTEMPTS = 40;

/**
 * Atomic "commit cache write only if we still own the recompute lock". Closes the
 * read-then-write invalidation race: a concurrent `invalidatePermissions` deletes the
 * lock key (single `DEL`), so a stale in-flight recompute that already read the old DB
 * rows finds `GET lock != nonce` and skips the write. Redis runs this script and the
 * invalidation `DEL` serially, so there is no interleaving window.
 */
const PERMISSION_CACHE_COMMIT_IF_LOCK_HELD_LUA =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 1 end; return 0";

/** Releases the recompute lock only when its value still matches our nonce (compare-and-del). */
const PERMISSION_CACHE_RELEASE_LOCK_IF_HELD_LUA =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0";

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

interface CommitCachedPermissionsOptions {
  userId: string;
  organizationId: string;
  lockKey: string;
  lockNonce: string;
  codes: string[];
}

/**
 * Writes freshly recomputed permission codes to the cache only if the recompute lock is
 * still held by this caller, atomically (see {@link PERMISSION_CACHE_COMMIT_IF_LOCK_HELD_LUA}).
 *
 * @remarks
 * - **Algorithm:** reads the org cache version, builds the versioned key, and runs the
 *   compare-and-set Lua so the `SET ... EX` only lands when `GET lockKey == lockNonce`.
 *   TTL is `default + jitter (0..60s)` to smear expirations.
 * - **Failure modes:** Redis errors are caught and logged (`permission-cache.commit.failed`);
 *   the call resolves so a cache write failure never blocks the request.
 * - **Side effects:** at most one Redis `SET` under `perm:<version>:...`.
 * - **Notes:** the guard makes the write a no-op when a concurrent `invalidatePermissions`
 *   already deleted the lock, preventing stale permissions from being re-cached.
 */
async function commitCachedPermissionsIfLockHeld(
  options: CommitCachedPermissionsOptions,
): Promise<void> {
  const { userId, organizationId, lockKey, lockNonce, codes } = options;
  try {
    const version = await getOrganizationCacheVersion(organizationId);
    /** Small jitter so many users do not expire and recompute in the same second. */
    const jitterSeconds = Math.floor(Math.random() * 61);
    await redisConnection.eval(
      PERMISSION_CACHE_COMMIT_IF_LOCK_HELD_LUA,
      2,
      lockKey,
      buildKey(version, userId, organizationId),
      lockNonce,
      JSON.stringify(codes),
      String(PERMISSION_CACHE_DEFAULT_TTL_SECONDS + jitterSeconds),
    );
  } catch (error) {
    logger.warn({ error }, 'permission-cache.commit.failed');
  }
}

/**
 * Runs a cache-miss recompute under a short Redis lock. Waiters poll for the cached value
 * so only one request per (user, organization) hits the database during a stampede.
 *
 * @remarks
 * - **Algorithm:** `SET key <nonce> EX <ttl> NX` to claim the lock with a unique
 *   per-call nonce; on success runs `recompute()`, then commits the result via
 *   {@link commitCachedPermissionsIfLockHeld} (a compare-and-set guarded on the
 *   nonce) and returns. Waiters poll up to `STAMPEDE_POLL_ATTEMPTS` ×
 *   `PERMISSION_CACHE_STAMPEDE_POLL_MS` (≈2s) for the cache to populate; if still empty, they fall
 *   through to a fresh recompute as a safety net (without caching, since they do
 *   not own the lock).
 * - **Failure modes:** Redis `SET` failure is logged
 *   (`permission-cache.lock.acquire.failed`) and the caller falls back to a
 *   direct `recompute()` without locking — the database carries the load.
 *   `recompute()` errors propagate to the caller.
 * - **Side effects:** Redis SET/DEL on `perm:lock:<user>:<org>`; one
 *   Postgres-hitting `recompute()` per stampede on the happy path; cache
 *   write through {@link commitCachedPermissionsIfLockHeld}.
 * - **Notes:** the lock TTL is
 *   {@link PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS}; the lock is released in a
 *   `finally` block via compare-and-del so an uncaught exception never strands it
 *   and we never delete a lock re-acquired by another recompute. Holding the lock
 *   nonce closes the read-then-write invalidation race: a concurrent
 *   {@link invalidatePermissions} deletes the lock key, so this caller's commit
 *   becomes a no-op instead of re-caching stale permissions.
 */
export async function withPermissionCacheRecomputeLock(
  userId: string,
  organizationId: string,
  recompute: () => Promise<string[]>,
): Promise<string[]> {
  const lockKey = buildRecomputeLockKey(userId, organizationId);
  const lockNonce = randomUUID();
  let acquiredLock = false;
  try {
    let lockResult: string | null;
    try {
      lockResult = await redisConnection.set(
        lockKey,
        lockNonce,
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
        await new Promise<void>((resolve) =>
          setTimeout(resolve, PERMISSION_CACHE_STAMPEDE_POLL_MS),
        );
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
    await commitCachedPermissionsIfLockHeld({
      userId,
      organizationId,
      lockKey,
      lockNonce,
      codes: fresh,
    });
    return fresh;
  } finally {
    if (acquiredLock) {
      try {
        await redisConnection.eval(
          PERMISSION_CACHE_RELEASE_LOCK_IF_HELD_LUA,
          1,
          lockKey,
          lockNonce,
        );
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
