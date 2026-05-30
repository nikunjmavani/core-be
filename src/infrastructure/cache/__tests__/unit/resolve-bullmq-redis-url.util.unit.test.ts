import { afterEach, describe, expect, it, vi } from 'vitest';

const environment: { REDIS_URL: string; REDIS_BULLMQ_URL: string | undefined } = {
  REDIS_URL: 'redis://cache.example.internal:6379/0',
  REDIS_BULLMQ_URL: undefined,
};

vi.mock('@/shared/config/env.config.js', () => ({
  get env() {
    return environment;
  },
}));

describe('resolveBullMqRedisUrl', () => {
  afterEach(() => {
    environment.REDIS_URL = 'redis://cache.example.internal:6379/0';
    environment.REDIS_BULLMQ_URL = undefined;
  });

  it('returns the dedicated REDIS_BULLMQ_URL when set', async () => {
    environment.REDIS_BULLMQ_URL = 'redis://bullmq.example.internal:6379/0';
    const { resolveBullMqRedisUrl } = await import('@/infrastructure/cache/redis-url.util.js');
    expect(resolveBullMqRedisUrl()).toBe('redis://bullmq.example.internal:6379/0');
  });

  it('falls back to REDIS_URL when REDIS_BULLMQ_URL is unset (local dev)', async () => {
    environment.REDIS_BULLMQ_URL = undefined;
    const { resolveBullMqRedisUrl } = await import('@/infrastructure/cache/redis-url.util.js');
    expect(resolveBullMqRedisUrl()).toBe('redis://cache.example.internal:6379/0');
  });
});
