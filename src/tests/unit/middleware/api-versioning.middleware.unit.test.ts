import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiVersioningUtilModule from '@/shared/utils/http/api-versioning.util.js';

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureMessage: vi.fn(),
}));

import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import apiVersioningMiddleware from '@/shared/middlewares/core/api-versioning.middleware.js';
import {
  applyDeprecatedEndpointHeaders,
  formatHttpDate,
  PUBLIC_API_VERSION_HEADER,
  PUBLIC_API_VERSION_VALUE_V1,
  resetSunsetAlertThrottleForTests,
} from '@/shared/utils/http/api-versioning.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

vi.mock('@/shared/utils/http/api-versioning.util.js', async (importOriginal) => {
  const original = await importOriginal<typeof ApiVersioningUtilModule>();
  return {
    ...original,
    PUBLIC_API_V1_SUNSET: new Date('2020-01-01T00:00:00.000Z'),
  };
});

const pastV1Sunset = new Date('2020-01-01T00:00:00.000Z');

describe('api-versioning.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    resetSunsetAlertThrottleForTests();
    vi.mocked(captureMessage).mockClear();
    if (application) {
      await application.close();
    }
  });

  it('sets API-Version on /api/v1 responses', async () => {
    application = Fastify({ logger: false });
    await application.register(apiVersioningMiddleware);
    application.get(testApiPath('/probe'), async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({
      method: 'GET',
      url: testApiPath('/probe'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[PUBLIC_API_VERSION_HEADER.toLowerCase()]).toBe(
      PUBLIC_API_VERSION_VALUE_V1,
    );
  });

  it('sets Sunset and Deprecation on /api/v1 when PUBLIC_API_V1_SUNSET is configured', async () => {
    application = Fastify({ logger: false });
    await application.register(apiVersioningMiddleware);
    application.get(testApiPath('/probe'), async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({
      method: 'GET',
      url: testApiPath('/probe'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.sunset).toBe(formatHttpDate(pastV1Sunset));
    expect(response.headers.deprecation).toBe('true');
  });

  it('does not set API-Version outside /api/v1', async () => {
    application = Fastify({ logger: false });
    await application.register(apiVersioningMiddleware);
    application.get('/internal/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/internal/probe' });
    expect(response.headers[PUBLIC_API_VERSION_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('alerts when a successful response is past its Sunset header', async () => {
    application = Fastify({ logger: false });
    await application.register(apiVersioningMiddleware);
    application.get('/deprecated-test', async (_request: FastifyRequest, reply: FastifyReply) => {
      applyDeprecatedEndpointHeaders(reply, {
        sunset: new Date('2020-01-01T00:00:00.000Z'),
        deprecation: true,
      });
      return { status: 'ok' };
    });
    await application.ready();

    await application.inject({ method: 'GET', url: '/deprecated-test' });

    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('API usage past sunset'),
      expect.objectContaining({ level: 'warning' }),
    );
  });
});
