import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
const redisPingMock = vi.fn().mockResolvedValue('PONG');
const bullmqPingMock = vi.fn().mockResolvedValue('PONG');
const pingBullMqMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: { ping: () => redisPingMock() },
}));

vi.mock('@/infrastructure/cache/bullmq-redis.client.js', () => ({
  bullmqRedisConnection: { ping: () => bullmqPingMock() },
}));

vi.mock('@/infrastructure/cache/redis-url.parse.util.js', () => ({
  usesSeparateBullMqRedisEndpoint: vi.fn().mockReturnValue(false),
}));

vi.mock('@/infrastructure/cache/redis-url.util.js', () => ({
  resolveBullMqRedisUrl: vi.fn().mockReturnValue('redis://127.0.0.1:6379'),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', REDIS_URL: 'redis://127.0.0.1:6379' },
}));

vi.mock('@/infrastructure/queue/health.js', () => ({
  pingBullMQ: () => pingBullMqMock(),
}));

import {
  getCachedDependencyReadinessProbes,
  resetReadinessProbeCacheForTests,
  runDependencyReadinessProbes,
} from '@/shared/utils/infrastructure/readiness-probes.util.js';

describe('readiness-probes.util caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([{ '?column?': 1 }]);
    redisPingMock.mockResolvedValue('PONG');
    pingBullMqMock.mockResolvedValue(undefined);
    resetReadinessProbeCacheForTests();
  });

  afterEach(() => {
    resetReadinessProbeCacheForTests();
  });

  it('reports ok when all dependency probes succeed', async () => {
    const summary = await getCachedDependencyReadinessProbes();
    expect(summary.status).toBe('ok');
    expect(summary.database).toBe('connected');
    expect(summary.redis).toBe('connected');
    expect(summary.bullmq).toBe('connected');
  });

  it('serves a cached result within the TTL instead of re-probing dependencies', async () => {
    await getCachedDependencyReadinessProbes();
    await getCachedDependencyReadinessProbes();

    // Second call within the short TTL must reuse the memoised summary.
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(pingBullMqMock).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent cache misses into a single in-flight probe round', async () => {
    const [first, second] = await Promise.all([
      getCachedDependencyReadinessProbes(),
      getCachedDependencyReadinessProbes(),
    ]);

    expect(first).toBe(second);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('re-probes after the cache is reset', async () => {
    redisPingMock.mockResolvedValueOnce('NOPE');
    const failed = await getCachedDependencyReadinessProbes();
    expect(failed.status).toBe('error');
    expect(failed.redis).toBe('unavailable');

    resetReadinessProbeCacheForTests();
    const recovered = await getCachedDependencyReadinessProbes();
    expect(recovered.status).toBe('ok');
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('runDependencyReadinessProbes stays uncached for the worker readiness signal', async () => {
    await runDependencyReadinessProbes();
    await runDependencyReadinessProbes();
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
