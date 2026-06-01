import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('health', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /readyz returns raw readiness payload', async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/readyz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'connected',
      redis: 'connected',
      bullmq: 'connected',
    });
  });
});
