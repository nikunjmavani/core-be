import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import { loadProtectedRoutesFromCatalog } from '@/tests/helpers/route-catalog-auth.js';
import type { FastifyInstance } from 'fastify';

const protectedRoutes = loadProtectedRoutesFromCatalog();

/**
 * Auth enforcement tests — verify protected routes from docs/routes.txt reject unauthenticated requests.
 */
describe('Security: Auth Enforcement', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;
    expect(protectedRoutes.length).toBeGreaterThan(45);
  });

  afterAll(async () => {
    await app.close();
  });

  for (const { method, path, access } of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} (${access}) should reject unauthenticated access`, async () => {
      const response = await request[method](path);
      // PERM routes may return 403 when auth middleware runs after missing org context in edge cases
      const expectedStatuses = access === 'PERM' ? [401, 403, 422] : [401];
      expect(expectedStatuses).toContain(response.status);
      expect(response.status).toBeLessThan(500);
    });
  }

  it('should reject expired or malformed tokens', async () => {
    const response = await request
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer invalid-token-value');
    expect(response.status).toBe(401);
  });

  it('should reject token with wrong prefix', async () => {
    const response = await request
      .get('/api/v1/users/me')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(response.status).toBe(401);
  });

  it('should reject empty Authorization header', async () => {
    const response = await request.get('/api/v1/users/me').set('Authorization', '');
    expect(response.status).toBe(401);
  });
});
