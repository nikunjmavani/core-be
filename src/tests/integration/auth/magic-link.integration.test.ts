import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

describe('Auth - Magic Link', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/v1/auth/magic-link/send returns 201 with message', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;

    const response = await request
      .post('/api/v1/auth/magic-link/send')
      .send({ email: 'nonexistent@example.com' });

    expect(response.status).toBe(201);
    expect((response.body as { data: { message: string } }).data.message).toContain('sign-in code');
  });

  it('POST /api/v1/auth/magic-link/verify returns 4xx with an unknown email / wrong code', async () => {
    const response = await request
      .post('/api/v1/auth/magic-link/verify')
      .send({ email: 'nobody-magic-verify@example.com', code: '000000' });

    // 401 for an unknown email / wrong code; 400 on a malformed body.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
