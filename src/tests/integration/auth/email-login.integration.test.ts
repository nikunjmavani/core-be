import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Auth - Email verification-code login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/v1/auth/email/send-code returns 201 with message', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email: 'nonexistent@example.com' },
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as { data: { message: string } }).data.message).toContain(
      'sign-in code',
    );
  });

  it('POST /api/v1/auth/email/login returns 4xx with an unknown email / wrong code', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: 'nobody-email-login@example.com', code: 'ZZZZZZ' },
    });

    // 401 for an unknown email / wrong code; 400 on a malformed body.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
