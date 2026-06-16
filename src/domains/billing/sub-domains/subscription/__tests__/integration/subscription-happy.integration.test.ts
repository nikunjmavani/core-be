import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticatedOrganizationMutation,
  injectRoute,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import { createTestSubscription } from '@/domains/billing/__tests__/factories/subscription.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { buildStripeWebhookTestSignatureHeader } from '@/tests/contract/helpers/stripe-signature.js';
import { env } from '@/shared/config/env.config.js';
import type { FastifyInstance } from 'fastify';

vi.mock('@/domains/billing/sub-domains/subscription/stripe-payment-provider.js', () => {
  class FakeStripePaymentProvider {
    isConfigured(): boolean {
      return true;
    }
    getProviderPriceId(): string {
      return 'price_test_fake';
    }
    async createSubscription(): Promise<{
      providerSubscriptionId: string;
      providerCustomerId: string;
    }> {
      return {
        providerSubscriptionId: `sub_fake_${Date.now()}`,
        providerCustomerId: `cus_fake_${Date.now()}`,
      };
    }
    async cancelSubscriptionAtPeriodEnd(): Promise<void> {}
    async cancelSubscriptionImmediately(): Promise<void> {}
    async resumeSubscription(): Promise<void> {}
    async updateSubscriptionPrice(): Promise<void> {}
  }
  return { StripePaymentProvider: FakeStripePaymentProvider };
});

const SUBSCRIPTION_PERMISSIONS = ['subscription:read', 'subscription:manage'];

/**
 * Happy paths for subscription create (201) and update (200) with the payment
 * provider mocked at the PaymentProvider port implementation, plus the legacy
 * `POST /billing/webhook` alias with a properly signed Stripe event (200).
 */
describe('Billing subscription — happy paths (mocked payment provider)', () => {
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
  });

  async function createAuthorizedBillingContext() {
    await seedPermissions(SUBSCRIPTION_PERMISSIONS);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: SUBSCRIPTION_PERMISSIONS,
      createdByUserId: user.id,
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
    return { user, organization, token };
  }

  it('POST /billing/subscriptions creates a subscription (201)', async () => {
    const { token } = await createAuthorizedBillingContext();
    const plan = await createTestPlan();

    const response = await injectAuthenticatedOrganizationMutation(app, {
      method: 'POST',
      url: testApiPath('/billing/subscriptions'),
      token,
      headers: { 'x-idempotency-key': `subscription-happy-${randomUUID()}` },
      payload: { plan_id: plan.public_id, billing_cycle: 'monthly' },
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it('PATCH /billing/subscriptions/:subscription_id returns the subscription (200)', async () => {
    const { organization, token } = await createAuthorizedBillingContext();
    const plan = await createTestPlan();
    const subscription = await createTestSubscription({
      organizationId: organization.id,
      planId: plan.id,
      providerSubscriptionId: `sub_patch_${Date.now()}`,
    });

    const response = await injectAuthenticatedOrganizationMutation(app, {
      method: 'PATCH',
      url: testApiPath(`/billing/subscriptions/${subscription.public_id}`),
      token,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('POST /billing/webhook (legacy alias) accepts a signed Stripe event (200)', async () => {
    const webhookSigningSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSigningSecret) {
      // Mirrors the sibling stripe-webhook suite: skip without a signing secret.
      return;
    }

    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const plan = await createTestPlan();
    const subscription = await createTestSubscription({
      organizationId: organization.id,
      planId: plan.id,
      providerSubscriptionId: `sub_legacy_${Date.now()}`,
    });

    const eventPayload = {
      id: `evt_legacy_${Date.now()}`,
      object: 'event',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subscription.provider_subscription_id,
          object: 'subscription',
          status: 'active',
          items: {
            data: [
              {
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 86_400,
              },
            ],
          },
        },
      },
    };
    const rawPayload = JSON.stringify(eventPayload);
    const stripeSignature = buildStripeWebhookTestSignatureHeader({
      rawPayload,
      webhookSigningSecret,
    });

    const response = await injectRoute(app, {
      method: 'POST',
      url: testApiPath('/billing/webhook'),
      headers: {
        'stripe-signature': stripeSignature,
        'content-type': 'application/json',
      },
      payload: Buffer.from(rawPayload),
    });
    expect(response.statusCode, response.body).toBe(200);
  });
});
