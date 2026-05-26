import Fastify from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { rateLimitPlugin } = vi.hoisted(() => ({
  rateLimitPlugin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@fastify/rate-limit', () => ({
  default: rateLimitPlugin,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_ORG_MAX: 200,
    RATE_LIMIT_WINDOW_MS: 60_000,
    REDIS_URL: 'redis://127.0.0.1:6379',
  },
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: { ping: vi.fn() },
}));

import rateLimitMiddleware from '@/shared/middlewares/rate-limit.middleware.js';

describe('rate-limit.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (application) {
      await application.close();
    }
  });

  it('uses Redis-backed rate limiting when RUN_REDIS_TESTS is enabled', async () => {
    const previousFlag = process.env.RUN_REDIS_TESTS;
    process.env.RUN_REDIS_TESTS = '1';
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        NODE_ENV: 'test',
        RATE_LIMIT_MAX: 100,
        RATE_LIMIT_WINDOW_MS: 60_000,
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
    }));
    const { default: redisRateLimitMiddleware } = await import(
      '@/shared/middlewares/rate-limit.middleware.js'
    );
    application = Fastify();
    await application.register(redisRateLimitMiddleware);
    await application.ready();

    const options = rateLimitPlugin.mock.calls.at(-1)![1] as { redis?: unknown };
    expect(options.redis).toBeDefined();
    process.env.RUN_REDIS_TESTS = previousFlag;
    vi.resetModules();
  });

  it('registers global rate limit without Redis in test environment', async () => {
    // max uses env.RATE_LIMIT_MAX (no per-org quota lookup)
    application = Fastify();
    await application.register(rateLimitMiddleware);
    await application.ready();

    expect(rateLimitPlugin).toHaveBeenCalled();
    const options = rateLimitPlugin.mock.calls[0]![1] as {
      global: boolean;
      max: (request: { organizationId?: string | null }) => number | Promise<number>;
      timeWindow: number;
      allowList: (request: { url: string }) => boolean;
    };
    expect(options.global).toBe(true);
    await expect(options.max({ organizationId: null })).resolves.toBe(100);
    await expect(options.max({ organizationId: 'org_public' })).resolves.toBe(200);
    expect(options.timeWindow).toBe(60_000);
    expect(options.allowList({ url: '/health' })).toBe(true);
    expect(options.allowList({ url: testApiPath('/auth/login') })).toBe(false);
  });

  it('registers in-memory rate limiting when Redis is not configured', async () => {
    const previousFlag = process.env.RUN_REDIS_TESTS;
    delete process.env.RUN_REDIS_TESTS;
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        NODE_ENV: 'development',
        RATE_LIMIT_MAX: 25,
        RATE_LIMIT_ORG_MAX: 50,
        RATE_LIMIT_WINDOW_MS: 15_000,
        REDIS_URL: undefined,
      },
    }));
    const { default: developmentRateLimitMiddleware } = await import(
      '@/shared/middlewares/rate-limit.middleware.js'
    );
    application = Fastify();
    await application.register(developmentRateLimitMiddleware);
    await application.ready();

    const options = rateLimitPlugin.mock.calls.at(-1)![1] as { redis?: unknown };
    expect(options.redis).toBeUndefined();
    process.env.RUN_REDIS_TESTS = previousFlag;
    vi.resetModules();
  });

  it('uses Redis-backed rate limiting in production', async () => {
    const previousFlag = process.env.RUN_REDIS_TESTS;
    delete process.env.RUN_REDIS_TESTS;
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        NODE_ENV: 'production',
        RATE_LIMIT_MAX: 50,
        RATE_LIMIT_ORG_MAX: 100,
        RATE_LIMIT_WINDOW_MS: 30_000,
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
    }));
    const { default: productionRateLimitMiddleware } = await import(
      '@/shared/middlewares/rate-limit.middleware.js'
    );
    application = Fastify();
    await application.register(productionRateLimitMiddleware);
    await application.ready();

    const options = rateLimitPlugin.mock.calls.at(-1)![1] as { redis?: unknown };
    expect(options.redis).toBeDefined();
    process.env.RUN_REDIS_TESTS = previousFlag;
    vi.resetModules();
  });

  describe('keyGenerator and allowList', () => {
    it('uses organization-scoped key when request.organizationId is set', async () => {
      application = Fastify();
      await application.register(rateLimitMiddleware);
      await application.ready();
      const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
        keyGenerator: (request: { organizationId?: string; ip: string }) => string;
      };
      expect(options.keyGenerator({ organizationId: 'org_public_1', ip: '1.2.3.4' })).toBe(
        'org:org_public_1',
      );
    });

    it('falls back to request.ip when organizationId is absent', async () => {
      application = Fastify();
      await application.register(rateLimitMiddleware);
      await application.ready();
      const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
        keyGenerator: (request: { organizationId?: string; ip: string }) => string;
      };
      expect(options.keyGenerator({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    });

    it('falls back to request.ip when organizationId is empty string', async () => {
      application = Fastify();
      await application.register(rateLimitMiddleware);
      await application.ready();
      const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
        keyGenerator: (request: { organizationId?: string; ip: string }) => string;
      };
      expect(options.keyGenerator({ organizationId: '', ip: '1.2.3.4' })).toBe('1.2.3.4');
    });

    it('allowList does not bypass non-health routes whose path includes "health" as a substring', async () => {
      application = Fastify();
      await application.register(rateLimitMiddleware);
      await application.ready();
      const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
        allowList: (request: { url: string }) => boolean;
      };
      // Real health endpoints are allowed
      expect(options.allowList({ url: '/health' })).toBe(true);
      expect(options.allowList({ url: '/health' })).toBe(true);
      expect(options.allowList({ url: '/health' })).toBe(true);

      // Look-alike paths must NOT be allowed (defense-in-depth: prefix match, not contains)
      expect(options.allowList({ url: '/api/v1/healthcheck' })).toBe(false);
      expect(options.allowList({ url: '/api/v1/health-tracker' })).toBe(false);
      expect(options.allowList({ url: '/foo/health/bar' })).toBe(false);
      expect(options.allowList({ url: '/api/v1/auth/login' })).toBe(false);
    });
  });
});
