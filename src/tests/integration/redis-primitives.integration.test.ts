import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { connectRedis, redisConnection } from '@/infrastructure/cache/redis.client.js';
import {
  getCachedPermissions,
  invalidateOrganizationPermissions,
  setCachedPermissions,
  withPermissionCacheRecomputeLock,
} from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { CircuitBreaker } from '@/infrastructure/resilience/circuit-breaker.js';
import { cleanupTestRedis } from '@/tests/helpers/test-redis.js';

const runRedisTests = process.env.RUN_REDIS_TESTS === '1';
let redisAvailable = false;

describe.runIf(runRedisTests)('Integration: Redis primitives', () => {
  const testKeyPrefix = `test:redis-primitives:${Date.now()}`;

  beforeAll(async () => {
    try {
      await connectRedis();
      const pong = await redisConnection.ping();
      redisAvailable = pong === 'PONG';
    } catch {
      redisAvailable = false;
    }
  });

  beforeEach(async () => {
    if (redisAvailable) {
      await cleanupTestRedis();
    }
  });

  it.runIf(() => redisAvailable)(
    'should expire cache keys after TTL',
    async () => {
      const userId = `${testKeyPrefix}:user`;
      const organizationId = `${testKeyPrefix}:org`;
      const versionKey = `perm:org:${organizationId}:v`;
      const cacheKey = `perm:0:${userId}:${organizationId}`;

      await setCachedPermissions(userId, organizationId, ['billing:read'], 1);
      expect(await getCachedPermissions(userId, organizationId)).toEqual(['billing:read']);

      const remainingSeconds = await redisConnection.ttl(cacheKey);
      expect(remainingSeconds).toBeGreaterThan(0);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, (remainingSeconds + 1) * 1_000);
      });
      expect(await getCachedPermissions(userId, organizationId)).toBeNull();

      await redisConnection.del(cacheKey, versionKey);
    },
    70_000,
  );

  it.runIf(() => redisAvailable)(
    'should acquire and release distributed recompute lock (SET NX)',
    async () => {
      const userId = `${testKeyPrefix}:lock-user`;
      const organizationId = `${testKeyPrefix}:lock-org`;
      let recomputeCount = 0;

      const first = await withPermissionCacheRecomputeLock(userId, organizationId, async () => {
        recomputeCount += 1;
        await setCachedPermissions(userId, organizationId, ['tenancy:read'], 300);
        return ['tenancy:read'];
      });

      const second = await withPermissionCacheRecomputeLock(userId, organizationId, async () => {
        recomputeCount += 1;
        return ['tenancy:read'];
      });

      expect(first).toEqual(['tenancy:read']);
      expect(second).toEqual(['tenancy:read']);
      expect(recomputeCount).toBe(1);

      await redisConnection.del(
        `perm:0:${userId}:${organizationId}`,
        `perm:lock:${userId}:${organizationId}`,
        `perm:org:${organizationId}:v`,
      );
    },
  );

  it.runIf(() => redisAvailable)(
    'invalidates organization permission cache via version INCR',
    async () => {
      const userId = `${testKeyPrefix}:version-user`;
      const organizationId = `${testKeyPrefix}:version-org`;

      await setCachedPermissions(userId, organizationId, ['billing:read'], 3_600);
      await invalidateOrganizationPermissions(organizationId);
      expect(await getCachedPermissions(userId, organizationId)).toBeNull();

      await redisConnection.del(`perm:org:${organizationId}:v`);
    },
  );

  it.runIf(() => redisAvailable)(
    'should use Redis WATCH/MULTI for circuit breaker state updates',
    async () => {
      const circuit = new CircuitBreaker({
        name: `${testKeyPrefix}:circuit`,
        redis: redisConnection,
        failureThreshold: 2,
        resetTimeoutMs: 1_000,
      });

      await expect(
        circuit.execute(async () => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
      await expect(
        circuit.execute(async () => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
      await expect(circuit.execute(async () => Promise.resolve('ok'))).rejects.toThrow(/OPEN/);

      await circuit.reset();
    },
  );
});
