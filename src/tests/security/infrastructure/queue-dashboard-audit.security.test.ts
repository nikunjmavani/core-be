import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { audit_outbox } from '@/domains/audit/audit-outbox.schema.js';
import type { FastifyInstance } from 'fastify';

/**
 * Mutating Bull Board API calls (2xx) under /admin/queues/api are audited.
 * ENABLE_QUEUE_DASHBOARD is set in test setup so the route is registered.
 *
 * Audit writes go through the transactional outbox (P0-#2): `auditService.record`
 * stages the row in `audit.outbox` synchronously within the request; the
 * audit-outbox-drain worker (not running in this test app) later resolves the
 * public ids and copies it into `audit.logs`. This suite asserts on the outbox —
 * the synchronous durability point — rather than the post-drain `audit.logs`.
 */
describe('Security: Queue dashboard audit', () => {
  let app: FastifyInstance;
  const previousEnableQueueDashboard = process.env.ENABLE_QUEUE_DASHBOARD;
  const previousEnableQueueDashboardMutations = process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS;

  beforeAll(async () => {
    process.env.ENABLE_QUEUE_DASHBOARD = 'true';
    process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS = 'true';
    resetEnvCacheForTests();
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
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
  });

  it('should not write an audit log for unauthenticated GET /admin/queues', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
    });
    expect(response.statusCode).toBe(401);

    const rows = await database.select().from(audit_outbox);
    expect(rows).toHaveLength(0);
  });

  it('should write an audit log when super_admin pauses a queue via Bull Board API', async () => {
    const user = await createTestUser();
    const token = await generateSuperAdminToken(user.public_id);

    const response = await injectAuthenticated(app, {
      method: 'PUT',
      url: '/admin/queues/api/queues/mail/pause',
      token,
    });

    expect(response.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const rows = await database
        .select()
        .from(audit_outbox)
        .where(eq(audit_outbox.action, 'queue.pause'));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_user_public_id).toBe(user.public_id);
      expect(rows[0]!.resource_type).toBe('queue');
      expect(rows[0]!.metadata).toMatchObject({
        queue: 'mail',
        method: 'PUT',
      });
    });
  });
});
