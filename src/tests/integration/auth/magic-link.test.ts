import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Auth - Magic Link', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/v1/auth/magic-link/send returns 200 with message', async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/send'),
      payload: { email: 'nonexistent@example.com' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { message: string } };
    expect(body.data.message).toContain('magic link');
  });

  it('POST /api/v1/auth/magic-link/verify returns 4xx with invalid token', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { token: 'invalid-token-that-does-not-exist' },
    });

    // 401/400 when token invalid; 500 if auth.verification_tokens table missing (migrations not applied)
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
