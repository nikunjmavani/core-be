import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import type { TestRequestAgent } from '@/tests/helpers/test-app.js';

/**
 * Queue dashboard (/admin/queues) is protected by JWT + SUPER_ADMIN role only.
 * ENABLE_QUEUE_DASHBOARD is set in test setup so the route is registered.
 */
describe('Security: Queue dashboard', () => {
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

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should return 401 without authentication', async () => {
    const response = await request.get('/admin/queues');
    expect(response.status).toBe(401);
  });

  it('should return 403 for non-admin user', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'user' });
    const response = await request.get('/admin/queues').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('should return 200 for super admin', async () => {
    const user = await createTestUser();
    const token = await generateSuperAdminToken(user.public_id);
    const response = await request.get('/admin/queues').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });

  it('should return 403 for admin role (not super_admin)', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'admin' });
    const response = await request.get('/admin/queues').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });
});
