import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

const publicRoutes: Array<{ method: 'get' | 'post'; path: string }> = [
  { method: 'get', path: '/health' },
  { method: 'get', path: '/api/v1/billing/plans' },
  { method: 'get', path: '/api/v1/auth/oauth/providers' },
  { method: 'post', path: '/api/v1/auth/magic-link/send' },
];

/**
 * Public route tests — endpoints that must not require Authorization.
 */
describe('Security: Public Routes', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of publicRoutes) {
    it(`${route.method.toUpperCase()} ${route.path} should not require Authorization`, async () => {
      const response =
        route.method === 'get'
          ? await request.get(route.path)
          : await request
              .post(route.path)
              .send(route.path.includes('magic-link') ? { email: 'public-route@example.com' } : {});
      expect(response.status).not.toBe(401);
      expect(response.status).toBeLessThan(500);
    });
  }
});
