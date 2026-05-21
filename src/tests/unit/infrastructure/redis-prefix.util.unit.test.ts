import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';

describe('resolveRedisKeyPrefix', () => {
  beforeEach(() => {
    delete process.env.REDIS_KEY_PREFIX;
    process.env.NODE_ENV = 'test';
    resetEnvCacheForTests();
  });

  afterEach(() => {
    delete process.env.REDIS_KEY_PREFIX;
    resetEnvCacheForTests();
  });

  it('defaults to core:<NODE_ENV>: when REDIS_KEY_PREFIX unset', () => {
    expect(resolveRedisKeyPrefix()).toBe('core:test:');
  });

  it('uses REDIS_KEY_PREFIX override and ensures trailing colon', () => {
    process.env.REDIS_KEY_PREFIX = 'myapp:qa';
    expect(resolveRedisKeyPrefix()).toBe('myapp:qa:');
  });
});
