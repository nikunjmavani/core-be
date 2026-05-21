import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Redis client module.
// NOTE: The factory passed to vi.mock is hoisted, so we must avoid
// referencing any top-level variables inside it.
vi.mock('@/infrastructure/cache/redis.client.js', () => {
  const redisConnection = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    scan: vi.fn(),
  };

  return { redisConnection };
});

import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import {
  getCachedPermissions,
  setCachedPermissions,
  invalidatePermissions,
} from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

/**
 * Permission keys are versioned (perm:{version}:{userId}:{orgId}) so that we
 * can invalidate organization-wide cache entries with a single INCR rather
 * than a SCAN sweep. When the version key is absent, the version is 0.
 */
const PERMISSION_KEY_VERSION_0 = 'perm:0:user-1:org-1';
const PERMISSION_LOCK_KEY = 'perm:lock:user-1:org-1';
const PERMISSION_VERSION_KEY = 'perm:org:org-1:v';

describe('PermissionCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCachedPermissions', () => {
    it('returns null on cache miss', async () => {
      vi.mocked(redisConnection.get).mockResolvedValue(null);
      const result = await getCachedPermissions('user-1', 'org-1');
      expect(result).toBeNull();
      expect(redisConnection.get).toHaveBeenCalledWith(PERMISSION_VERSION_KEY);
      expect(redisConnection.get).toHaveBeenCalledWith(PERMISSION_KEY_VERSION_0);
    });

    it('returns parsed codes on cache hit', async () => {
      vi.mocked(redisConnection.get).mockImplementation(async (key) => {
        if (key === PERMISSION_VERSION_KEY) return null;
        return JSON.stringify(['billing:read', 'billing:manage']);
      });
      const result = await getCachedPermissions('user-1', 'org-1');
      expect(result).toEqual(['billing:read', 'billing:manage']);
    });

    it('returns null on Redis error', async () => {
      vi.mocked(redisConnection.get).mockRejectedValue(new Error('Redis down'));
      const result = await getCachedPermissions('user-1', 'org-1');
      expect(result).toBeNull();
    });
  });

  describe('setCachedPermissions', () => {
    it('stores codes in Redis with TTL plus jitter', async () => {
      vi.mocked(redisConnection.get).mockResolvedValue(null);
      vi.mocked(redisConnection.set).mockResolvedValue('OK');
      await setCachedPermissions('user-1', 'org-1', ['billing:read'], 600);
      expect(redisConnection.set).toHaveBeenCalledTimes(1);
      const args = vi.mocked(redisConnection.set).mock.calls[0]!;
      expect(args[0]).toBe(PERMISSION_KEY_VERSION_0);
      expect(args[1]).toBe('["billing:read"]');
      expect(args[2]).toBe('EX');
      const ttlSeconds = Number(args[3]);
      expect(ttlSeconds).toBeGreaterThanOrEqual(600);
      expect(ttlSeconds).toBeLessThanOrEqual(600 + 60);
    });
  });

  describe('invalidatePermissions', () => {
    it('deletes the cache key and recompute lock', async () => {
      vi.mocked(redisConnection.get).mockResolvedValue(null);
      vi.mocked(redisConnection.del).mockResolvedValue(1);
      await invalidatePermissions('user-1', 'org-1');
      expect(redisConnection.del).toHaveBeenCalledWith(
        PERMISSION_KEY_VERSION_0,
        PERMISSION_LOCK_KEY,
      );
    });
  });
});
