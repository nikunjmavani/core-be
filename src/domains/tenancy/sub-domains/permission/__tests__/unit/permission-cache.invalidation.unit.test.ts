import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
  },
}));

import { redisConnection } from '@/infrastructure/cache/redis.client.js';
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

  it('invalidateOrganizationPermissions calls INCR on the org version key', async () => {
    vi.mocked(redisConnection.incr).mockResolvedValue(1);
    await invalidateOrganizationPermissions('org_public_id');
    expect(redisConnection.incr).toHaveBeenCalledTimes(1);
    expect(redisConnection.incr).toHaveBeenCalledWith('perm:org:org_public_id:v');
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
});
