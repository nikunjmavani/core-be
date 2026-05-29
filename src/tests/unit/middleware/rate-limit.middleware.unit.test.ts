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

  it('registers a global IP-keyed rate limit without Redis in test environment', async () => {
    application = Fastify();
    await application.register(rateLimitMiddleware);
    await application.ready();

    expect(rateLimitPlugin).toHaveBeenCalled();
    const options = rateLimitPlugin.mock.calls[0]![1] as {
      global: boolean;
      max: number;
      timeWindow: number;
      skipOnError: boolean;
      allowList: (request: { url: string }) => boolean;
    };
    expect(options.global).toBe(true);
    // Global cap is a fixed per-IP number; org/user quotas live in post-auth presets.
    expect(options.max).toBe(100);
    expect(options.timeWindow).toBe(60_000);
    // Fail-open on Redis blip — a few seconds of unmetered traffic beats a blanket 5xx.
    expect(options.skipOnError).toBe(true);
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

    const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
      redis?: unknown;
      skipOnError: boolean;
    };
    expect(options.redis).toBeDefined();
    // Fail-open must also be set in production so a Redis blip cannot blanket-5xx the API.
    expect(options.skipOnError).toBe(true);
    process.env.RUN_REDIS_TESTS = previousFlag;
    vi.resetModules();
  });

  it('always sets skipOnError: true so Redis outages cannot blanket-fail the API', async () => {
    const previousFlag = process.env.RUN_REDIS_TESTS;
    delete process.env.RUN_REDIS_TESTS;
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        NODE_ENV: 'development',
        RATE_LIMIT_MAX: 25,
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

    // Even the in-memory configuration registers skipOnError: true, so the option is
    // never accidentally dropped when toggling between stores.
    const options = rateLimitPlugin.mock.calls.at(-1)![1] as { skipOnError: boolean };
    expect(options.skipOnError).toBe(true);
    process.env.RUN_REDIS_TESTS = previousFlag;
    vi.resetModules();
  });

  describe('keyGenerator and allowList', () => {
    it('always keys on request.ip, ignoring the request-asserted organizationId', async () => {
      application = Fastify();
      await application.register(rateLimitMiddleware);
      await application.ready();
      const options = rateLimitPlugin.mock.calls.at(-1)![1] as {
        keyGenerator: (request: { organizationId?: string; ip: string }) => string;
      };
      // A forged/fresh or victim org id must not influence the global per-IP bucket.
      expect(options.keyGenerator({ organizationId: 'org_public_1', ip: '1.2.3.4' })).toBe(
        '1.2.3.4',
      );
      expect(options.keyGenerator({ ip: '1.2.3.4' })).toBe('1.2.3.4');
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
      expect(options.allowList({ url: testApiPath('/healthcheck') })).toBe(false);
      expect(options.allowList({ url: testApiPath('/health-tracker') })).toBe(false);
      expect(options.allowList({ url: '/foo/health/bar' })).toBe(false);
      expect(options.allowList({ url: testApiPath('/auth/login') })).toBe(false);
    });
  });
});
