import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import {
  PUBLIC_API_VERSION_HEADER,
  PUBLIC_API_VERSION_VALUE_V1,
} from '@/shared/utils/http/api-versioning.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Security: API versioning headers', () => {
  let application: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    application = testApplication;
  });

  afterAll(async () => {
    await application.close();
  });

  it('includes API-Version on public /api/v1 routes', async () => {
    const response = await injectUnauthenticated(application, {
      method: 'GET',
      url: testApiPath('/auth/oauth/providers'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[PUBLIC_API_VERSION_HEADER.toLowerCase()]).toBe(
      PUBLIC_API_VERSION_VALUE_V1,
    );
  });
});
