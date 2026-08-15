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
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { createTestSubscription } from '@/domains/billing/__tests__/factories/subscription.factory.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
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

  /** Authorized context plus a local-only ACTIVE subscription to address by public id. */
  async function createContextWithSubscription() {
    const { organization, token } = await createAuthorizedContext();
    const plan = await createTestPlan();
    const subscription = await createTestSubscription({
      organizationId: organization.id,
      planId: plan.id,
      status: 'INCOMPLETE',
      providerSubscriptionId: null,
      providerCustomerId: 'cus_test_subscription_integration',
    });
    return { organization, token, plan, subscription };
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
    it('should return 422 when X-Idempotency-Key header is missing', async () => {
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
        headers: { 'x-idempotency-key': 'subscription-create-missing-body-key' },
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('PATCH /api/v1/billing/subscriptions/:subscription_id', () => {
    it('should return 400 when the body carries cancel_at_period_end (sec-B1)', async () => {
      // `validateUpdateSubscription` refuses `cancel_at_period_end` so a PATCH cannot flip the
      // local flag without a matching Stripe call — clients must use /cancel and /resume. That
      // refusal was unit-proven only; with no boundary case, a validator that stopped being
      // wired into the route would let the divergence back in silently.
      const { organization, token, subscription } = await createContextWithSubscription();

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/billing/subscriptions/${subscription.public_id}`),
        token,
        organizationPublicId: organization.public_id,
        payload: { cancel_at_period_end: true },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept an empty body (no billing-state field is PATCHable)', async () => {
      // The non-vacuous contrast: the 400 above is about the rejected FIELD, not about PATCH
      // being broken.
      const { organization, token, subscription } = await createContextWithSubscription();

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/billing/subscriptions/${subscription.public_id}`),
        token,
        organizationPublicId: organization.public_id,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ─── GET payment-setup ──────────────────────────────────────────────────────
  //
  // One case existed for this route (a 200 in `billing-payment-methods.e2e.test.ts`). It carries
  // a Stripe PaymentIntent `client_secret`, so "who may read it" is the property that matters.
  describe('GET /api/v1/billing/subscriptions/:subscription_id/payment-setup', () => {
    it('should return 401 without authentication', async () => {
      const { subscription } = await createContextWithSubscription();

      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${subscription.public_id}/payment-setup`),
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for a member without subscription:read', async () => {
      const { organization, subscription } = await createContextWithSubscription();
      const outsider = await createTestUser({
        email: `noperm-setup-${generatePublicId('user')}@test.com`,
      });
      const outsiderToken = await generateTestToken({
        userId: outsider.public_id,
        organizationPublicId: organization.public_id,
      });

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${subscription.public_id}/payment-setup`),
        token: outsiderToken,
        organizationPublicId: organization.public_id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for an unknown subscription id', async () => {
      const { organization, token } = await createContextWithSubscription();

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(
          `/billing/subscriptions/${generatePublicId('subscription')}/payment-setup`,
        ),
        token,
        organizationPublicId: organization.public_id,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
