import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
      error: new z.ZodError([{ code: 'custom', path: ['DATABASE_URL'], message: 'Required' }]),
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
    // sec-C5: previously used JWT_SECRET as the invalid field; that key was
    // removed from the schema. Use JWT_PRIVATE_KEY (still required) instead.
    const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
    const redisUrl = process.env.REDIS_URL;
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.REDIS_URL;
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/JWT_PRIVATE_KEY/);
    process.env.JWT_PRIVATE_KEY = jwtPrivateKey;
    process.env.REDIS_URL = redisUrl;
    resetEnvCacheForTests();
  });

  it('omits fields without validation messages when building the message', () => {
    const parseSpy = vi.spyOn(envSchema, 'safeParse').mockReturnValue({
      success: false,
      error: new z.ZodError([{ code: 'custom', path: ['DATABASE_URL'], message: 'Required' }]),
    } as never);
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    parseSpy.mockRestore();
    resetEnvCacheForTests();
  });

  it('lists every field that has a validation message, comma-separated', () => {
    const parseSpy = vi.spyOn(envSchema, 'safeParse').mockReturnValue({
      success: false,
      error: new z.ZodError([
        { code: 'custom', path: ['DATABASE_URL'], message: 'Required' },
        { code: 'custom', path: ['REDIS_URL'], message: 'Required' },
      ]),
    } as never);
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
    expect(() => getEnv()).toThrow(/REDIS_URL/);
    parseSpy.mockRestore();
    resetEnvCacheForTests();
  });
});
