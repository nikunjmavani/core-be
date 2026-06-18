import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { createRedisFallbackRateLimitStore } from '@/shared/middlewares/rate-limit/rate-limit-fallback-store.js';

interface IncrResult {
  current: number;
  ttl: number;
}

function incrAsync(
  store: {
    incr: (
      k: string,
      cb: (e: Error | null, r: IncrResult | null) => void,
      w: number,
      m: number,
    ) => void;
  },
  key: string,
  timeWindow: number,
  max: number,
): Promise<IncrResult> {
  return new Promise((resolve, reject) => {
    store.incr(
      key,
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('no result'));
          return;
        }
        resolve(result);
      },
      timeWindow,
      max,
    );
  });
}

describe('createRedisFallbackRateLimitStore', () => {
  it('counts via a single Lua EVAL (first hit sets the window, later hits read PTTL)', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce([1, 1000]).mockResolvedValueOnce([2, 873]),
    } as unknown as Redis;
    const StoreCtor = createRedisFallbackRateLimitStore(redis);
    const store = new StoreCtor({}) as never;

    const first = await incrAsync(store, '1.2.3.4', 1000, 5);
    const second = await incrAsync(store, '1.2.3.4', 1000, 5);

    expect(first).toEqual({ current: 1, ttl: 1000 });
    expect(second).toEqual({ current: 2, ttl: 873 });
    // One round-trip per hit: a single EVAL with the prefixed bucket key and window (ms).
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'fastify-rate-limit-1.2.3.4',
      '1000',
    );
  });

  it('falls over to per-process counting when Redis rejects', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Redis;
    const StoreCtor = createRedisFallbackRateLimitStore(redis);
    const store = new StoreCtor({}) as never;

    const first = await incrAsync(store, '9.9.9.9', 1000, 5);
    const second = await incrAsync(store, '9.9.9.9', 1000, 5);

    expect(first.current).toBe(1);
    expect(second.current).toBe(2);
  });

  it('child stores isolate buckets by route prefix', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as Redis;
    const StoreCtor = createRedisFallbackRateLimitStore(redis);
    const store = new StoreCtor({}) as never as {
      incr: Parameters<typeof incrAsync>[0]['incr'];
      child: (options: { routeInfo: { method: string; url: string } }) => never;
    };
    const child = store.child({ routeInfo: { method: 'POST', url: '/auth/login' } });

    const parentHit = await incrAsync(store, 'ip', 1000, 5);
    const childHit = await incrAsync(child as never, 'ip', 1000, 5);

    // Separate prefixes ⇒ both start at 1 despite the same key.
    expect(parentHit.current).toBe(1);
    expect(childHit.current).toBe(1);
  });

  it('evicts old local buckets instead of growing without bound during Redis outages', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as Redis;
    const StoreCtor = createRedisFallbackRateLimitStore(redis);
    const store = new StoreCtor({}) as never;

    for (let index = 0; index < 10_000; index++) {
      await incrAsync(store, `ip-${index}`, 60_000, 5);
    }

    await incrAsync(store, 'overflow', 60_000, 5);

    await expect(incrAsync(store, 'ip-0', 60_000, 5)).resolves.toMatchObject({ current: 1 });
    await expect(incrAsync(store, 'ip-9999', 60_000, 5)).resolves.toMatchObject({ current: 2 });
    await expect(incrAsync(store, 'overflow', 60_000, 5)).resolves.toMatchObject({ current: 2 });
  });
});
