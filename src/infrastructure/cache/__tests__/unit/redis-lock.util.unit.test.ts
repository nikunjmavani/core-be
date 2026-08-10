import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { mockedRedisSet } from '@/tests/helpers/redis-mock.helper.js';
import {
  RedisLockUnavailableError,
  withRedisLock,
} from '@/infrastructure/cache/redis-lock.util.js';

describe('withRedisLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redisConnection.eval).mockResolvedValue(1 as never);
  });

  it('acquires the lock, runs fn, and releases via the nonce-guarded Lua', async () => {
    mockedRedisSet(redisConnection.set).mockResolvedValue('OK');

    const result = await withRedisLock({ key: 'lock:a', ttlSeconds: 10 }, async () => 'value');

    expect(result).toBe('value');
    const setArgs = mockedRedisSet(redisConnection.set).mock.calls[0]!;
    expect(setArgs[0]).toBe('lock:a');
    expect(setArgs[2]).toBe('EX');
    expect(setArgs[3]).toBe(10);
    expect(setArgs[4]).toBe('NX');
    // Release runs the compare-and-del Lua with the same nonce written on acquire.
    const evalArgs = vi.mocked(redisConnection.eval).mock.calls[0]!;
    expect(String(evalArgs[0])).toContain("redis.call('DEL', KEYS[1])");
    expect(evalArgs[2]).toBe('lock:a');
    expect(evalArgs[3]).toBe(setArgs[1]); // nonce round-trips
  });

  it('releases the lock even when fn throws', async () => {
    mockedRedisSet(redisConnection.set).mockResolvedValue('OK');

    await expect(
      withRedisLock({ key: 'lock:b', ttlSeconds: 10 }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(redisConnection.eval).toHaveBeenCalledTimes(1);
  });

  it('fails fast with RedisLockUnavailableError on contention when waitTimeoutMs is 0', async () => {
    mockedRedisSet(redisConnection.set).mockResolvedValue(null); // NX fails — lock held

    await expect(
      withRedisLock({ key: 'lock:c', ttlSeconds: 10 }, async () => 'never'),
    ).rejects.toBeInstanceOf(RedisLockUnavailableError);
    // fn never runs, so no release either.
    expect(redisConnection.eval).not.toHaveBeenCalled();
  });

  it('waits and acquires once the lock frees within waitTimeoutMs', async () => {
    mockedRedisSet(redisConnection.set).mockResolvedValueOnce(null).mockResolvedValue('OK');

    const result = await withRedisLock(
      { key: 'lock:d', ttlSeconds: 10, waitTimeoutMs: 200, pollIntervalMs: 10 },
      async () => 'acquired',
    );

    expect(result).toBe('acquired');
    expect(mockedRedisSet(redisConnection.set).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
