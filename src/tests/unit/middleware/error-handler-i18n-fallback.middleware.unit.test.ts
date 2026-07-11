import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import errorHandlerMiddleware from '@/shared/middlewares/core/error-handler.middleware.js';

/**
 * Regression: a raw `errors:*` i18n key must NEVER reach the client in `detail`.
 *
 * The captcha security preHandler throws `new UnauthorizedError('errors:captchaRequired')`
 * before the i18n hook has decorated `request.t`, so the serializer used to fall
 * back to the messageKey and leak the raw key. The error handler now resolves
 * against the initialised i18next singleton (default language) as a fallback.
 *
 * The singleton is mocked here as it is at runtime once the i18n middleware has
 * booted: initialised, with the `errors` namespace resolvable.
 */
vi.mock('i18next', () => ({
  default: {
    isInitialized: true,
    t: (key: string) =>
      key === 'errors:captchaRequired' ? 'CAPTCHA verification is required' : key,
  },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: vi.fn(),
}));

describe('error handler i18n singleton fallback', () => {
  it('resolves detail via the i18next singleton when request.t is absent', async () => {
    // No decorateRequest('t') — mirrors an error thrown before the i18n hook runs.
    const app = Fastify({ logger: false });
    await app.register(errorHandlerMiddleware);
    app.get('/captcha', async () => {
      throw new UnauthorizedError('errors:captchaRequired');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/captcha' });
    expect(response.statusCode).toBe(401);
    // Client receives a human string, NOT the raw `errors:captchaRequired` key.
    expect(response.json().error.detail).toBe('CAPTCHA verification is required');
    await app.close();
  });

  it('falls back to the messageKey only when the singleton also cannot resolve it', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerMiddleware);
    app.get('/unknown', async () => {
      throw new UnauthorizedError('errors:someUnmappedKey');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/unknown' });
    expect(response.statusCode).toBe(401);
    // Singleton returns the key unchanged → last-resort fallback (messageKey).
    expect(response.json().error.detail).toBe('errors:someUnmappedKey');
    await app.close();
  });
});
