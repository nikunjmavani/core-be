import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

const publicRoutes: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/livez' },
  { method: 'GET', path: '/readyz' },
  { method: 'GET', path: '/api/v1/auth/oauth/providers' },
  { method: 'POST', path: '/api/v1/auth/email/send-code' },
];

/**
 * Public route tests — endpoints that must not require Authorization.
 */
describe('Security: Public Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of publicRoutes) {
    it(`${route.method} ${route.path} should not require Authorization`, async () => {
      const response = await injectUnauthenticated(app, {
        method: route.method,
        url: route.path,
        payload:
          route.method === 'POST'
            ? route.path.includes('email-code')
              ? { email: 'public-route@example.com' }
              : {}
            : undefined,
      });
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).toBeLessThan(500);
    });
  }
});
