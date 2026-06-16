import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
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
    // cleanupDatabase() truncates tenancy.role_permissions; organization
    // provisioning (organization-provisioning.ts) inserts role_permissions
    // referencing every tenancy permission code, so the permission reference
    // rows must be present or the POST below fails with the
    // role_permissions_permission_code_permissions_code_fk FK violation.
    // Re-seed the full tenancy catalog (idempotent ON CONFLICT DO NOTHING),
    // mirroring the organization-onboarding e2e.
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  it('creates organization then reads billing plans', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const createResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
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
