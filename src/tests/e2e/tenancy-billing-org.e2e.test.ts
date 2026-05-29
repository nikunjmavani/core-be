import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Cross-domain e2e: tenancy + billing organization', () => {
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

  it('creates organization then reads billing plans', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const createResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'idempotency-key': `idem-${randomUUID()}` },
      payload: { name: 'Billing E2E Org', slug: `billing-e2e-${Date.now()}` },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { data: { id: string } };

    const plansResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/billing/plans'),
      token,
      organizationPublicId: created.data.id,
    });
    expect(plansResponse.statusCode).toBe(200);
  });
});
