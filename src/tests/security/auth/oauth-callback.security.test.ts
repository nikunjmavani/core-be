import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectRoute } from '@/tests/helpers/test-http-inject.helper.js';

describe('Security: OAuth callback query boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/oauth/:provider/callback returns 400 when state is missing', async () => {
    const response = await injectRoute(app, {
      method: 'GET',
      url: testApiPath('/auth/oauth/google/callback?code=oauth-auth-code'),
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /auth/oauth/:provider/callback returns 400 when code is missing', async () => {
    const response = await injectRoute(app, {
      method: 'GET',
      url: testApiPath('/auth/oauth/google/callback?state=oauth-state-token'),
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /auth/oauth/:provider/callback returns 401 for unknown state', async () => {
    const response = await injectRoute(app, {
      method: 'GET',
      url: testApiPath(
        '/auth/oauth/google/callback?code=oauth-auth-code&state=unknown-state-token',
      ),
    });
    expect(response.statusCode).toBe(401);
  });
});
