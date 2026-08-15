import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { FastifyInstance } from 'fastify';

/**
 * Admin user-management happy paths (`ROLE: super_admin, admin` routes) — the
 * declared success status of every /users/:user_id admin route observed with a
 * super_admin caller.
 */
describe('User admin routes — happy paths', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    // SUPER_ADMIN is re-derived per request from GLOBAL_ADMIN_EMAILS (sec-A6):
    // the actor's email must be allowlisted, ACTIVE, and verified.
    const admin = await createTestUser({ email: 'ops@example.com', isEmailVerified: true });
    adminToken = await generateTestToken({ userId: admin.public_id, role: 'super_admin' });
  });

  it('GET /users/:user_id returns the target profile', async () => {
    const target = await createTestUser();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/users/${target.public_id}`),
      token: adminToken,
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('PATCH /users/:user_id updates profile fields', async () => {
    const target = await createTestUser();
    const response = await injectAuthenticated(app, {
      method: 'PATCH',
      url: testApiPath(`/users/${target.public_id}`),
      token: adminToken,
      payload: { first_name: 'Updated' },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('POST /users/:user_id/suspend then /unsuspend round-trips status', async () => {
    const target = await createTestUser();

    const suspend = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/users/${target.public_id}/suspend`),
      token: adminToken,
    });
    expect(suspend.statusCode, suspend.body).toBe(201);

    const unsuspend = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/users/${target.public_id}/unsuspend`),
      token: adminToken,
    });
    expect(unsuspend.statusCode, unsuspend.body).toBe(201);
  });

  it('DELETE /users/:user_id soft-deletes the target', async () => {
    const target = await createTestUser();
    const response = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath(`/users/${target.public_id}`),
      token: adminToken,
    });
    expect(response.statusCode, response.body).toBe(204);
  });

  /**
   * Denial paths for the same three routes. Each previously asserted its happy path and nothing
   * else — including `PATCH` and `DELETE /users/:user_id`, the two destructive admin operations,
   * where a missing authorization check would have gone unnoticed by every user-owned test.
   */
  describe('denials', () => {
    /** Well-formed but unallocated — proves 404 (not found) rather than 422 (bad id shape). */
    const UNKNOWN_USER_ID = generatePublicId('user');

    it('GET /users/:user_id returns 403 for a plain user', async () => {
      const caller = await createTestUser();
      const target = await createTestUser();
      const token = await generateTestToken({ userId: caller.public_id, role: 'user' });

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/users/${target.public_id}`),
        token,
      });
      expect(response.statusCode, response.body).toBe(403);
    });

    it('GET /users/:user_id returns 404 for an unknown user id', async () => {
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/users/${UNKNOWN_USER_ID}`),
        token: adminToken,
      });
      expect(response.statusCode, response.body).toBe(404);
    });

    it('PATCH /users/:user_id returns 403 for a plain user', async () => {
      const caller = await createTestUser();
      const target = await createTestUser();
      const token = await generateTestToken({ userId: caller.public_id, role: 'user' });

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/users/${target.public_id}`),
        token,
        payload: { first_name: 'Nope' },
      });
      expect(response.statusCode, response.body).toBe(403);
    });

    it('PATCH /users/:user_id returns 404 for an unknown user id', async () => {
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/users/${UNKNOWN_USER_ID}`),
        token: adminToken,
        payload: { first_name: 'Ghost' },
      });
      expect(response.statusCode, response.body).toBe(404);
    });

    it('DELETE /users/:user_id returns 403 for a plain user', async () => {
      const caller = await createTestUser();
      const target = await createTestUser();
      const token = await generateTestToken({ userId: caller.public_id, role: 'user' });

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/users/${target.public_id}`),
        token,
      });
      expect(response.statusCode, response.body).toBe(403);
    });

    it('DELETE /users/:user_id returns 404 for an unknown user id', async () => {
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/users/${UNKNOWN_USER_ID}`),
        token: adminToken,
      });
      expect(response.statusCode, response.body).toBe(404);
    });
  });
});
