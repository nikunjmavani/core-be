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

  it('regular user GET /users/:user_id → denied (401/403)', async () => {
    const regularUser = await createTestUser();
    const targetUser = await createTestUser();
    const token = await generateTestToken({ userId: regularUser.public_id });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/users/${targetUser.public_id}`),
      token,
    });
    expect([401, 403]).toContain(response.statusCode);
  });

  it('regular user DELETE /users/:user_id → denied (401/403)', async () => {
    const regularUser = await createTestUser();
    const targetUser = await createTestUser();
    const token = await generateTestToken({ userId: regularUser.public_id });
    const response = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath(`/users/${targetUser.public_id}`),
      token,
    });
    expect([401, 403]).toContain(response.statusCode);
  });

  it('baseline: global admin GET /users/:user_id → not 403', async () => {
    const adminUser = await createTestUser({ email: globalAdminEmail });
    const targetUser = await createTestUser();
    const token = await generateTestToken({ userId: adminUser.public_id });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/users/${targetUser.public_id}`),
      token,
    });
    expect(response.statusCode).not.toBe(403);
  });
});
