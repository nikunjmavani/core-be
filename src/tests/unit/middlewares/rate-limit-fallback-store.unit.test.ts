import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { createRedisFallbackRateLimitStore } from '@/shared/middlewares/rate-limit-fallback-store.js';

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
  it('counts via Redis when healthy (INCR + PEXPIRE on first hit)', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(900),
    } as unknown as Redis;
    const StoreCtor = createRedisFallbackRateLimitStore(redis);
    const store = new StoreCtor({}) as never;

    const result = await incrAsync(store, '1.2.3.4', 1000, 5);

    expect(result).toEqual({ current: 1, ttl: 1000 });
    expect(redis.pexpire).toHaveBeenCalledWith('fastify-rate-limit-1.2.3.4', 1000);
  });

  it('falls over to per-process counting when Redis rejects', async () => {
    const redis = {
      incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      pexpire: vi.fn(),
      pttl: vi.fn(),
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
      incr: vi.fn().mockRejectedValue(new Error('down')),
      pexpire: vi.fn(),
      pttl: vi.fn(),
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
});
