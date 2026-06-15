import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import type { FastifyInstance } from 'fastify';

const SUBSCRIPTION_PERMISSIONS = ['subscription:read', 'subscription:manage'];

describe('Subscription Sub-Domain — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(SUBSCRIPTION_PERMISSIONS);
  });

  async function createAuthorizedContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: SUBSCRIPTION_PERMISSIONS,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { organization, token };
  }

  describe('GET /api/v1/billing/subscriptions', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/subscriptions'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without subscription read permission', async () => {
      const { organization } = await createAuthorizedContext();
      const user = await createTestUser({ email: 'noperm-sub@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/subscriptions'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return subscriptions with permission', async () => {
      const { token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/subscriptions'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/billing/subscriptions', () => {
    it('should return 422 when Idempotency-Key header is missing', async () => {
      const { token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/billing/subscriptions'),
        token,
        payload: {
          plan_id: 'plan_test',
          billing_cycle: 'monthly',
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it('should return 400 for missing body', async () => {
      const { token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/billing/subscriptions'),
        token,
        headers: { 'idempotency-key': 'subscription-create-missing-body-key' },
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });
});
