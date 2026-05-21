import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * Queue dashboard (/admin/queues) is protected by JWT + SUPER_ADMIN role only.
 * ENABLE_QUEUE_DASHBOARD is set in test setup so the route is registered.
 */
describe('Security: Queue dashboard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should return 401 without authentication', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should return 403 for non-admin user', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'user' });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
      token,
    });
    expect(response.statusCode).toBe(403);
  });

  it('should return 200 for super admin', async () => {
    const user = await createTestUser();
    const token = await generateSuperAdminToken(user.public_id);
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
      token,
    });
    expect(response.statusCode).toBe(200);
  });

  it('should return 403 for admin role (not super_admin)', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'admin' });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
      token,
    });
    expect(response.statusCode).toBe(403);
  });
});
