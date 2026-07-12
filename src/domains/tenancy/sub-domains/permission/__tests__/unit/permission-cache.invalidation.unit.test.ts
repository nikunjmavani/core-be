import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: vi.fn(),
}));

import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureException } from '@/infrastructure/observability/sentry/sentry.js';
import {
  getCachedPermissions,
  setCachedPermissions,
  invalidatePermissions,
  invalidateOrganizationPermissions,
  withPermissionCacheRecomputeLock,
} from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

describe('permission-cache service invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidateOrganizationPermissions bumps the org version + refreshes its TTL via one Lua', async () => {
    vi.mocked(redisConnection.eval).mockResolvedValue(1 as never);
    await invalidateOrganizationPermissions('org_public_id');
    expect(redisConnection.eval).toHaveBeenCalledTimes(1);
    const evalArgs = vi.mocked(redisConnection.eval).mock.calls[0]!;
    // Lua bumps + expires; the version key never lingers TTL-less (audit-#T3).
    expect(String(evalArgs[0])).toContain("redis.call('INCR'");
    expect(String(evalArgs[0])).toContain("redis.call('EXPIRE'");
    expect(evalArgs[2]).toBe('perm:org:org_public_id:v');
    expect(Number(evalArgs[3])).toBeGreaterThan(300);
  });

  it('getCachedPermissions returns null when Redis throws (graceful failure)', async () => {
    vi.mocked(redisConnection.get).mockRejectedValue(new Error('redis down'));
    const result = await getCachedPermissions('user_public_id', 'org_public_id');
    expect(result).toBeNull();
  });

  it('setCachedPermissions stores JSON-encoded codes with TTL and version key (replaces "does nothing when version read fails" — version reader silently returns 0 on Redis errors, so SET still happens with version 0)', async () => {
    vi.mocked(redisConnection.get).mockResolvedValue('3');
    vi.mocked(redisConnection.set).mockResolvedValue('OK');
    await setCachedPermissions('user_public_id', 'org_public_id', ['tenancy:read']);
    expect(redisConnection.set).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(redisConnection.set).mock.calls[0]!;
    expect(callArgs[0]).toBe('perm:3:user_public_id:org_public_id');
    expect(callArgs[1]).toBe(JSON.stringify(['tenancy:read']));
    expect(callArgs[2]).toBe('EX');
    expect(typeof callArgs[3]).toBe('number');
    expect(Number(callArgs[3]) >= 300).toBe(true);
  });

  it('invalidatePermissions deletes the user+org cache key and recompute lock (closest equivalent to invalidateUserPermissions — the source exposes per-user+org invalidation; cross-org sweep is provided via invalidateOrganizationPermissions)', async () => {
    vi.mocked(redisConnection.get).mockResolvedValue('7');
    vi.mocked(redisConnection.del).mockResolvedValue(2);
    await invalidatePermissions('user_public_id', 'org_public_id');
    expect(redisConnection.del).toHaveBeenCalledTimes(1);
    const delArgs = vi.mocked(redisConnection.del).mock.calls[0]!;
    expect(delArgs).toContain('perm:7:user_public_id:org_public_id');
    expect(delArgs).toContain('perm:lock:user_public_id:org_public_id');
  });

  it('commits the recomputed value via the lock-guarded Lua (closing the invalidation race)', async () => {
    // Lock acquired, cache empty: the happy path must write through the compare-and-set Lua
    // (guarded on the lock nonce), never a bare SET that could clobber a concurrent invalidation.
    vi.mocked(redisConnection.set).mockResolvedValue('OK');
    vi.mocked(redisConnection.get).mockImplementation(async (key) => {
      if (String(key).startsWith('perm:org:')) return '0';
      return null;
    });
    vi.mocked(redisConnection.eval).mockResolvedValue(1 as never);

    const result = await withPermissionCacheRecomputeLock('user_public_id', 'org_public_id', () =>
      Promise.resolve(['tenancy:read']),
    );

    expect(result).toEqual(['tenancy:read']);
    expect(redisConnection.set).not.toHaveBeenCalledWith(
      'perm:0:user_public_id:org_public_id',
      expect.anything(),
      'EX',
      expect.anything(),
    );
    const commitCall = vi
      .mocked(redisConnection.eval)
      .mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("redis.call('SET'"),
      );
    expect(commitCall, 'commit went through the guarded Lua').toBeDefined();
    // KEYS[1] = lock key, KEYS[2] = cache key, ARGV[1] = lock nonce.
    expect(commitCall?.[2]).toBe('perm:lock:user_public_id:org_public_id');
    expect(commitCall?.[3]).toBe('perm:0:user_public_id:org_public_id');
    expect(commitCall?.[5]).toBe(JSON.stringify(['tenancy:read']));
  });

  it('withPermissionCacheRecomputeLock only runs one concurrent recomputation per user+org', async () => {
    /** First caller acquires lock; second caller sees NX-fail (null) and polls for the cached value. */
    vi.mocked(redisConnection.set)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null)
      .mockResolvedValue('OK');

    let cachedValue: string | null = null;
    const versionValue = '0';
    vi.mocked(redisConnection.get).mockImplementation(async (key) => {
      const keyString = String(key);
      if (keyString.startsWith('perm:org:')) return versionValue;
      return cachedValue;
    });
    vi.mocked(redisConnection.del).mockResolvedValue(1);

    const recompute = vi.fn(async () => {
      cachedValue = JSON.stringify(['tenancy:read']);
      return ['tenancy:read'];
    });

    const [first, second] = await Promise.all([
      withPermissionCacheRecomputeLock('user_public_id', 'org_public_id', recompute),
      withPermissionCacheRecomputeLock('user_public_id', 'org_public_id', recompute),
    ]);

    expect(first).toEqual(['tenancy:read']);
    expect(second).toEqual(['tenancy:read']);
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('commit binds to the org version captured BEFORE recompute, so an org-wide invalidation mid-recompute orphans the stale commit (audit-#H1)', async () => {
    vi.mocked(redisConnection.set).mockResolvedValue('OK');
    vi.mocked(redisConnection.eval).mockResolvedValue(1 as never);
    // The org version is 0 when the recompute starts; a concurrent org-wide invalidation bumps
    // it to 1 while the recompute runs. The commit must still target the CAPTURED version 0.
    let versionBumpedMidRecompute = false;
    vi.mocked(redisConnection.get).mockImplementation(async (key) => {
      if (String(key).startsWith('perm:org:')) return versionBumpedMidRecompute ? '1' : '0';
      return null; // cache empty → recompute runs
    });

    const result = await withPermissionCacheRecomputeLock(
      'user_public_id',
      'org_public_id',
      async () => {
        versionBumpedMidRecompute = true;
        return ['tenancy:read'];
      },
    );

    expect(result).toEqual(['tenancy:read']);
    const commitCall = vi
      .mocked(redisConnection.eval)
      .mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("redis.call('SET'"),
      );
    expect(commitCall, 'commit went through the guarded Lua').toBeDefined();
    // KEYS[2] (cache key) must use captured version 0, NOT the post-bump version 1.
    expect(commitCall?.[3]).toBe('perm:0:user_public_id:org_public_id');
  });

  it('invalidatePermissions surfaces a Redis failure to Sentry and bumps the org version as a backstop (audit-#T0/#T1)', async () => {
    vi.mocked(redisConnection.get).mockResolvedValue('4');
    vi.mocked(redisConnection.del).mockRejectedValue(new Error('redis blip'));
    vi.mocked(redisConnection.eval).mockResolvedValue(2 as never);

    await invalidatePermissions('user_public_id', 'org_public_id');

    // The failure is not swallowed as success: Sentry fires…
    expect(captureException).toHaveBeenCalledTimes(1);
    // …and the backstop over-invalidates the org so the stale entry cannot survive to its TTL.
    expect(redisConnection.eval).toHaveBeenCalledTimes(1);
    const backstopArgs = vi.mocked(redisConnection.eval).mock.calls[0]!;
    expect(String(backstopArgs[0])).toContain("redis.call('INCR'");
    expect(backstopArgs[2]).toBe('perm:org:org_public_id:v');
  });

  it('getOrganizationCacheVersion no longer masquerades a Redis error as version 0 (audit-#T0)', async () => {
    // A read-path caller (setCachedPermissions) must NOT write under perm:0 when the version
    // read fails — it degrades to a safe no-op instead of caching under the wrong namespace.
    vi.mocked(redisConnection.get).mockRejectedValue(new Error('redis down'));
    vi.mocked(redisConnection.set).mockResolvedValue('OK');
    await setCachedPermissions('user_public_id', 'org_public_id', ['tenancy:read']);
    expect(redisConnection.set).not.toHaveBeenCalled();
  });
});
