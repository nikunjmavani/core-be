import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

/**
 * Global-role (BFLA) attack matrix — model `global-role` in
 * route-authorization-model.json. The `/users/:user_id` admin surface is gated
 * by the JWT global role (super_admin/admin, re-derived from GLOBAL_ADMIN_EMAILS
 * per request). A regular authenticated user must be denied (401/403); a global
 * admin must not be (baseline). Runs in CI (Postgres + Redis required).
 */
describe('Security: global-role admin routes reject non-admins (model: global-role)', () => {
  let app: FastifyInstance;
  const globalAdminEmail = (process.env.GLOBAL_ADMIN_EMAILS ?? 'ops@example.com')
    .split(',')[0]!
    .trim();

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  // Every by-id admin route is gated by the same `requireRole` preHandler. A
  // valid body is supplied for the PATCH so the role guard (preHandler) is what
  // produces the denial — not Fastify body validation, which runs first and
  // would otherwise mask the 403 with a 422 on an invalid body.
  const adminRouteCases: ReadonlyArray<{
    label: string;
    method: 'GET' | 'PATCH' | 'DELETE' | 'POST';
    path: (userPublicId: string) => string;
    body?: Record<string, unknown>;
  }> = [
    { label: 'GET /users/:user_id', method: 'GET', path: (id) => `/users/${id}` },
    { label: 'PATCH /users/:user_id', method: 'PATCH', path: (id) => `/users/${id}`, body: {} },
    { label: 'DELETE /users/:user_id', method: 'DELETE', path: (id) => `/users/${id}` },
    { label: 'POST /users/:user_id/suspend', method: 'POST', path: (id) => `/users/${id}/suspend` },
    {
      label: 'POST /users/:user_id/unsuspend',
      method: 'POST',
      path: (id) => `/users/${id}/unsuspend`,
    },
  ];

  it.each(adminRouteCases)('regular user $label → denied (401/403)', async ({
    method,
    path,
    body,
  }) => {
    const regularUser = await createTestUser();
    const targetUser = await createTestUser();
    const token = await generateTestToken({ userId: regularUser.public_id });
    const response = await injectAuthenticated(app, {
      method,
      url: testApiPath(path(targetUser.public_id)),
      token,
      ...(body ? { payload: body } : {}),
    });
    expect([401, 403]).toContain(response.statusCode);
  });

  it('baseline: global admin GET /users/:user_id → not 403', async () => {
    // SUPER_ADMIN is re-derived per request from GLOBAL_ADMIN_EMAILS (sec-A6): the actor's
    // email must be allowlisted AND verified, and the token must carry the admin role.
    const adminUser = await createTestUser({ email: globalAdminEmail, isEmailVerified: true });
    const targetUser = await createTestUser();
    const token = await generateTestToken({ userId: adminUser.public_id, role: 'super_admin' });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/users/${targetUser.public_id}`),
      token,
    });
    expect(response.statusCode).not.toBe(403);
  });
});
