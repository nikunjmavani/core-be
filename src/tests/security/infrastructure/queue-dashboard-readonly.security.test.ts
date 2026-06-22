import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import type { FastifyInstance } from 'fastify';

describe('Security: queue dashboard read-only mutations', () => {
  let application: FastifyInstance;
  let superAdminToken: string;
  const previousEnableQueueDashboard = process.env.ENABLE_QUEUE_DASHBOARD;
  const previousEnableQueueDashboardMutations = process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS;

  beforeAll(async () => {
    process.env.ENABLE_QUEUE_DASHBOARD = 'true';
    process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS = 'false';
    // getEnv() caches; the global test setup sets MUTATIONS=true, so the read-only guard would
    // otherwise read the stale cached value. Reset the cache so the override takes effect.
    resetEnvCacheForTests();
    const testApplication = await createTestApp();
    application = testApplication.app;
  });

  afterAll(async () => {
    await application.close();
    if (previousEnableQueueDashboard === undefined) {
      delete process.env.ENABLE_QUEUE_DASHBOARD;
    } else {
      process.env.ENABLE_QUEUE_DASHBOARD = previousEnableQueueDashboard;
    }
    if (previousEnableQueueDashboardMutations === undefined) {
      delete process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS;
    } else {
      process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS = previousEnableQueueDashboardMutations;
    }
    resetEnvCacheForTests();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    // Create the user first, then elevate it to super_admin — otherwise the token references a
    // non-existent user (cleanupDatabase TRUNCATEs) and auth 401s before the read-only guard runs.
    const user = await createTestUser();
    superAdminToken = await generateSuperAdminToken(user.public_id);
  });

  it('blocks PUT pause mutation when ENABLE_QUEUE_DASHBOARD_MUTATIONS is false', async () => {
    const response = await application.inject({
      method: 'PUT',
      url: '/admin/queues/api/queues/mail/pause',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    // re-audit LOW: the caller is an authenticated SUPER_ADMIN, so read-only mode is a 403
    // (forbidden), not a 401 (unauthenticated) — matches the documented behavior.
    expect(response.statusCode).toBe(403);
  });
});
