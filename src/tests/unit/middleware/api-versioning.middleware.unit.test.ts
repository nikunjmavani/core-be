import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import apiVersioningMiddleware from '@/shared/middlewares/core/api-versioning.middleware.js';
import {
  PUBLIC_API_VERSION_HEADER,
  PUBLIC_API_VERSION_VALUE_V1,
} from '@/shared/utils/http/api-versioning.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('api-versioning.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
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

  it('does not set API-Version outside /api/v1', async () => {
    application = Fastify({ logger: false });
    await application.register(apiVersioningMiddleware);
    application.get('/internal/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/internal/probe' });
    expect(response.headers[PUBLIC_API_VERSION_HEADER.toLowerCase()]).toBeUndefined();
  });
});
