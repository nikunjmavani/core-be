import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * Billing permissions imported inline to avoid cross-domain coupling in test setup.
 */
const BILLING_PERMISSIONS = {
  SUBSCRIPTION_READ: 'subscription:read',
  SUBSCRIPTION_MANAGE: 'subscription:manage',
} as const;

const ALL_BILLING_PERMISSIONS = Object.values(BILLING_PERMISSIONS);

describe('Billing Domain — Integration', () => {
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
    await seedPermissions(ALL_BILLING_PERMISSIONS);
  });

  async function createAuthorizedBillingContext(permissionCodes = ALL_BILLING_PERMISSIONS) {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes,
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
    return { user, organization, role, token };
  }

  // ─── Plans (public read) ────────────────────────────────────

  describe('GET /api/v1/billing/plans', () => {
    it('should return plans without authentication', async () => {
      const response = await injectUnauthenticated(app, { url: testApiPath('/billing/plans') });
      expect(response.statusCode).toBe(200);
    });

    it('should return plans with authentication', async () => {
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });

    it('should include created plan in list', async () => {
      await createTestPlan({ name: 'Pro Plan' });
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Array<{ name: string }> };
      const planNames = body.data.map((plan) => plan.name);
      expect(planNames).toContain('Pro Plan');
    });
  });

  describe('GET /api/v1/billing/plans/:id', () => {
    it('should return plan without authentication', async () => {
      const plan = await createTestPlan();
      const response = await injectUnauthenticated(app, {
        url: testApiPath(`/billing/plans/${plan.public_id}`),
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return plan by public ID', async () => {
      const plan = await createTestPlan();
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticated(app, {
        url: testApiPath(`/billing/plans/${plan.public_id}`),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });

    it('should return 404 for non-existent plan', async () => {
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/billing/plans/nonexistent'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Subscriptions ────────────────────────────────────────────

  describe('GET /api/v1/billing/subscriptions', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/billing/subscriptions'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without subscription read permission', async () => {
      const { organization } = await createAuthorizedBillingContext();
      const user = await createTestUser({ email: 'noperm@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/billing/subscriptions'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return subscriptions with permission', async () => {
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/billing/subscriptions'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/billing/subscriptions', () => {
    it('should return 400 for missing body', async () => {
      const { token } = await createAuthorizedBillingContext();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/billing/subscriptions'),
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  // ─── Stripe Webhook ───────────────────────────────────────────

  describe('POST /api/v1/billing/webhook', () => {
    it('should return 400 for missing signature', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/billing/webhook'),
        payload: { type: 'test' },
      });
      expect([400, 401]).toContain(response.statusCode);
    });

    it('should return 400 for invalid stripe-signature header', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/billing/webhook'),
        headers: { 'stripe-signature': 'invalid' },
        payload: { type: 'customer.subscription.updated', data: { object: {} } },
      });
      expect([400, 401]).toContain(response.statusCode);
    });
  });
});
