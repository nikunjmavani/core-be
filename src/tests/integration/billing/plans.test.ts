import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Billing - Plans', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    const user = await createTestUser();
    token = await generateTestToken({ userId: user.public_id });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/billing/plans returns 200 without authentication', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/billing/plans'),
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET /api/v1/billing/plans returns 200 with empty list when authenticated', async () => {
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/billing/plans'),
      token,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/v1/billing/plans/:id returns 404 for nonexistent plan when authenticated', async () => {
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/billing/plans/nonexistent-id'),
      token,
    });

    expect(response.statusCode).toBe(404);
  });
});
