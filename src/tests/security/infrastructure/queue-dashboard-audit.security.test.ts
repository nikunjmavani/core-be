import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { logs } from '@/domains/audit/audit.schema.js';
import type { FastifyInstance } from 'fastify';

/**
 * Mutating Bull Board API calls (2xx) under /admin/queues/api are written to audit.logs.
 * ENABLE_QUEUE_DASHBOARD is set in test setup so the route is registered.
 */
describe('Security: Queue dashboard audit', () => {
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

  it('should not write an audit log for unauthenticated GET /admin/queues', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/admin/queues',
    });
    expect(response.statusCode).toBe(401);

    const rows = await database.select().from(logs);
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

    const rows = await database.select().from(logs).where(eq(logs.action, 'queue.pause'));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_id).toBe(user.id);
    expect(rows[0]!.resource_type).toBe('queue');
    expect(rows[0]!.metadata).toMatchObject({
      queue: 'mail',
      method: 'PUT',
    });
  });
});
