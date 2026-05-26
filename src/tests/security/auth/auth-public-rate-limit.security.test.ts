import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.stubEnv('NODE_ENV', 'production');
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
});
