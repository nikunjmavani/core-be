import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'production' as string,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  Sentry: { addBreadcrumb: vi.fn() },
}));

/**
 * Verifies STRICT_PUBLIC_RATE_LIMIT (5 req / 60s per IP in production) used by auth signup routes.
 */
describe('Security: Auth public rate limit burst (429)', () => {
  const apps: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    while (apps.length > 0) {
      const application = apps.pop();
      if (application) await application.close();
    }
  });

  async function createAuthStylePublicRouteApp() {
    mockEnv.NODE_ENV = 'production';
    vi.resetModules();
    const { STRICT_PUBLIC_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );

    const application = Fastify();
    await application.register(rateLimit, { global: false });
    application.post(
      '/auth/magic-link/send',
      {
        ...STRICT_PUBLIC_RATE_LIMIT,
      },
      async () => ({ data: { message: 'ok' } }),
    );
    application.post(
      '/auth/login',
      {
        ...STRICT_PUBLIC_RATE_LIMIT,
      },
      async () => ({ data: { access_token: 'token' } }),
    );
    await application.ready();
    apps.push(application);
    return application;
  }

  it('caps magic-link-style public POST at 5 req/min per IP (6th returns 429)', async () => {
    const application = await createAuthStylePublicRouteApp();
    const responses = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      responses.push(
        await application.inject({
          method: 'POST',
          url: '/auth/magic-link/send',
          payload: { email: `burst-${attempt}@example.com` },
        }),
      );
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => response.statusCode === 429).length).toBeGreaterThan(0);
  });

  it('caps login-style public POST at 5 req/min per IP (6th returns 429)', async () => {
    const application = await createAuthStylePublicRouteApp();
    const responses = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      responses.push(
        await application.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: `burst-${attempt}@example.com`, password: 'x' },
        }),
      );
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => response.statusCode === 429).length).toBeGreaterThan(0);
  });

  async function createPerEmailRouteApp() {
    mockEnv.NODE_ENV = 'production';
    vi.resetModules();
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );

    const application = Fastify();
    await application.register(rateLimit, { global: false });
    const perEmailRateLimit = application.rateLimit(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS);
    application.post('/auth/login', { preHandler: [perEmailRateLimit] }, async () => ({
      data: { message: 'ok' },
    }));
    await application.ready();
    apps.push(application);
    return application;
  }

  it('caps a single email at 5 attempts / window regardless of IP (6th returns 429)', async () => {
    const application = await createPerEmailRouteApp();
    const responses = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      responses.push(
        await application.inject({
          method: 'POST',
          url: '/auth/login',
          // Vary the forwarded IP to prove the bucket is keyed by email, not IP.
          headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
          payload: { email: 'victim@example.com', password: 'x' },
        }),
      );
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => response.statusCode === 429).length).toBeGreaterThan(0);
  });

  it('keeps per-email buckets independent — a fresh email is not throttled by another', async () => {
    const application = await createPerEmailRouteApp();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await application.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'noisy@example.com', password: 'x' },
      });
    }
    const otherEmailResponse = await application.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'quiet@example.com', password: 'x' },
    });
    expect(otherEmailResponse.statusCode).toBe(200);
  });
});
