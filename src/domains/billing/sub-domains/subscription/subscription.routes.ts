import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { BILLING_PERMISSIONS } from '@/domains/billing/billing.permissions.js';
import type { SubscriptionService } from './subscription.service.js';
import { createSubscriptionController } from './subscription.controller.js';
import { ChangePlanDto, CreateSubscriptionDto, UpdateSubscriptionDto } from './subscription.dto.js';

/**
 * Fastify plugin factory that mounts the organization-scoped subscription
 * endpoints (CRUD + change-plan / cancel / resume). All routes require auth
 * and a {@link BILLING_PERMISSIONS} permission; create additionally enforces
 * the `Idempotency-Key` header (`idempotencyRequired: true`) on externally
 * mutating billing routes.
 */
export function subscriptionRoutes(service: SubscriptionService): FastifyPluginAsync {
  const controller = createSubscriptionController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/subscriptions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ, 'id')],
        schema: {
          summary: 'List subscriptions',
          description:
            'Returns all subscriptions for the organization. Requires SUBSCRIPTION_READ permission.',
          tags: ['Billing', 'Subscription'],
        },
      },
      controller.listSubscriptions,
    );
    zodApplication.get<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ, 'id')],
        schema: {
          summary: 'Get subscription',
          description:
            'Returns a single subscription with its current status. Requires SUBSCRIPTION_READ permission.',
          tags: ['Billing', 'Subscription'],
        },
      },
      controller.getSubscription,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/subscriptions',
      {
        config: { idempotencyRequired: true },
        schema: {
          summary: 'Create subscription',
          description:
            'Creates a new subscription for the organization. Only one active subscription is allowed. Requires SUBSCRIPTION_MANAGE permission. Send an `Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Billing', 'Subscription'],
          body: CreateSubscriptionDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.createSubscription,
    );
    zodApplication.patch<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId',
      {
        schema: {
          summary: 'Update subscription',
          description:
            'Updates subscription settings (e.g. cancel at period end). Requires SUBSCRIPTION_MANAGE permission.',
          tags: ['Billing', 'Subscription'],
          body: UpdateSubscriptionDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.updateSubscription,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/change-plan',
      {
        config: { idempotencyRequired: true },
        schema: {
          summary: 'Change subscription plan',
          description:
            'Upgrades or downgrades the subscription to a different plan. Proration is applied automatically. Requires SUBSCRIPTION_MANAGE permission. Send an `Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Billing', 'Subscription'],
          body: ChangePlanDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.changePlan,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/cancel',
      {
        config: { idempotencyRequired: true },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
        schema: {
          summary: 'Cancel subscription',
          description:
            'Cancels the subscription. By default, access continues until the end of the current billing period. Requires SUBSCRIPTION_MANAGE permission. Send an `Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Billing', 'Subscription'],
        },
      },
      controller.cancelSubscription,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/resume',
      {
        config: { idempotencyRequired: true },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
        schema: {
          summary: 'Resume cancelled subscription',
          description:
            'Resumes a subscription that was previously cancelled but has not yet expired. Requires SUBSCRIPTION_MANAGE permission. Send an `Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Billing', 'Subscription'],
        },
      },
      controller.resumeSubscription,
    );
  };
}
