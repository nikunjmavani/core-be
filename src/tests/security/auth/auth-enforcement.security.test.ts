import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { loadProtectedRoutesFromCatalog } from '@/tests/helpers/route-catalog-auth.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

const protectedRoutes = loadProtectedRoutesFromCatalog();

/**
 * Auth enforcement tests — verify protected routes from docs/routes.txt reject unauthenticated requests.
 */
describe('Security: Auth Enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    expect(protectedRoutes.length).toBeGreaterThan(45);
  });

  afterAll(async () => {
    await app.close();
  });

  for (const { method, path, access } of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} (${access}) should reject unauthenticated access`, async () => {
      const response = await injectUnauthenticated(app, {
        method: method.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: path,
      });
      // PERM routes may return 403 when auth middleware runs after missing org context in edge cases
      const expectedStatuses = access === 'PERM' ? [400, 401, 403, 422] : [400, 401, 422];
      expect(expectedStatuses).toContain(response.statusCode);
      expect(response.statusCode).toBeLessThan(500);
    });
  }

  it('should reject expired or malformed tokens', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: 'Bearer invalid-token-value' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject token with wrong prefix', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject empty Authorization header', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: '' },
    });
    expect(response.statusCode).toBe(401);
  });
});
