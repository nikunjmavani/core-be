import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

describe('Security: queue dashboard read-only mutations', () => {
  let application: FastifyInstance;
  let superAdminToken: string;

  beforeAll(async () => {
    process.env.ENABLE_QUEUE_DASHBOARD = 'true';
    process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS = 'false';
    const testApplication = await createTestApp();
    application = testApplication.app;
  });

  afterAll(async () => {
    await application.close();
    delete process.env.ENABLE_QUEUE_DASHBOARD;
    delete process.env.ENABLE_QUEUE_DASHBOARD_MUTATIONS;
  });

  beforeEach(async () => {
    await cleanupDatabase();
    superAdminToken = await generateSuperAdminToken();
  });

  it('blocks PUT pause mutation when ENABLE_QUEUE_DASHBOARD_MUTATIONS is false', async () => {
    const response = await application.inject({
      method: 'PUT',
      url: '/admin/queues/api/queues/mail/pause',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    expect([401, 403]).toContain(response.statusCode);
  });
});
