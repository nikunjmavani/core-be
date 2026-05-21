import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { envSchema } from '@/shared/config/env-schema.js';

describe('env.config', () => {
  afterEach(() => {
    resetEnvCacheForTests();
  });

  it('getEnv parses valid process.env and caches the result', () => {
    resetEnvCacheForTests();
    const first = getEnv();
    const second = getEnv();
    expect(first.NODE_ENV).toBeDefined();
    expect(second).toBe(first);
  });

  it('resetEnvCacheForTests allows re-parsing after env changes', () => {
    const originalNodeEnvironment = process.env.NODE_ENV;
    getEnv();
    process.env.NODE_ENV = 'test';
    resetEnvCacheForTests();
    expect(getEnv().NODE_ENV).toBe('test');
    process.env.NODE_ENV = originalNodeEnvironment;
    resetEnvCacheForTests();
  });

  it('throws listing only fields that include validation messages', () => {
    const parseSpy = vi.spyOn(envSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: {
            DATABASE_URL: ['Required'],
            JWT_SECRET: [],
            PORT: undefined,
          },
        }),
      },
    } as never);
    resetEnvCacheForTests();
    let message = '';
    try {
      getEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toMatch(/JWT_SECRET/);
    parseSpy.mockRestore();
    resetEnvCacheForTests();
  });

  it('throws with only fields that have validation messages', () => {
    const originalPort = process.env.PORT;
    process.env.PORT = 'not-a-number';
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/PORT/);
    process.env.PORT = originalPort;
    resetEnvCacheForTests();
  });

  it('throws when required environment variables are missing', () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/Missing or invalid environment variables/);
    process.env.DATABASE_URL = databaseUrl;
    resetEnvCacheForTests();
  });

  it('throws with a comma-separated list of invalid field names', () => {
    const jwtSecret = process.env.JWT_SECRET;
    const redisUrl = process.env.REDIS_URL;
    process.env.JWT_SECRET = 'short';
    delete process.env.REDIS_URL;
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = jwtSecret;
    process.env.REDIS_URL = redisUrl;
    resetEnvCacheForTests();
  });

  it('ignores field error entries with undefined issue lists when building the message', () => {
    const parseSpy = vi.spyOn(envSchema, 'safeParse').mockReturnValue({
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: {
            DATABASE_URL: ['Required'],
            REDIS_URL: undefined,
          },
        }),
      },
    } as never);
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    parseSpy.mockRestore();
    resetEnvCacheForTests();
  });

  it('ignores field error entries with empty issue lists when building the message', () => {
    const parseSpy = vi.spyOn(envSchema, 'safeParse').mockReturnValue({
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: {
            DATABASE_URL: ['Required'],
            REDIS_URL: [],
          },
        }),
      },
    } as never);
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    expect(() => getEnv()).not.toThrow(/REDIS_URL/);
    parseSpy.mockRestore();
    resetEnvCacheForTests();
  });
});
