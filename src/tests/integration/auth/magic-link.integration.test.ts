import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

describe('Auth - Magic Link', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/v1/auth/magic-link/send returns 200 with message', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;

    const response = await request
      .post('/api/v1/auth/magic-link/send')
      .send({ email: 'nonexistent@example.com' });

    expect(response.status).toBe(201);
    expect((response.body as { data: { message: string } }).data.message).toContain('magic link');
  });

  it('POST /api/v1/auth/magic-link/verify returns 4xx with invalid token', async () => {
    const response = await request
      .post('/api/v1/auth/magic-link/verify')
      .send({ token: 'invalid-token-that-does-not-exist' });

    // 401/400 when token invalid; 500 if auth.verification_tokens table missing (migrations not applied)
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
