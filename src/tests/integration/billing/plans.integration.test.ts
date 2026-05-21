import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

describe('Billing - Plans', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/billing/plans returns 200 with empty list', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;

    const response = await request.get('/api/v1/billing/plans');

    expect(response.status).toBe(200);
    expect(Array.isArray((response.body as { data: unknown }).data)).toBe(true);
  });

  it('GET /api/v1/billing/plans/:id returns 404 for nonexistent plan', async () => {
    const response = await request.get('/api/v1/billing/plans/nonexistent-id');

    expect(response.status).toBe(404);
  });
});
