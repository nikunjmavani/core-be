import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { BILLING_PERMISSIONS } from '@/domains/billing/billing.permissions.js';
import type { SubscriptionService } from './subscription.service.js';
import { createSubscriptionController } from './subscription.controller.js';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  subscriptionIdParamsDto,
  UpdateSubscriptionDto,
} from './subscription.dto.js';

/**
 * Fastify plugin factory that mounts the organization-scoped subscription
 * endpoints (CRUD + change-plan / cancel / resume). All routes require auth
 * and a {@link BILLING_PERMISSIONS} permission; create additionally enforces
 * the `X-Idempotency-Key` header (`idempotencyRequired: true`) on externally
 * mutating billing routes.
 */
export function subscriptionRoutes(service: SubscriptionService): FastifyPluginAsync {
  const controller = createSubscriptionController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/subscriptions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ)],
        schema: {
          summary: 'List subscriptions',
          description:
            'Returns all subscriptions for the organization. Requires SUBSCRIPTION_READ permission.',
          tags: ['Subscription'],
        },
      },
      controller.listSubscriptions,
    );
    zodApplication.get<{ Params: { subscription_id: string } }>(
      '/subscriptions/:subscription_id',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ)],
        schema: {
          summary: 'Get subscription',
          description:
            'Returns a single subscription with its current status. Requires SUBSCRIPTION_READ permission.',
          tags: ['Subscription'],
          params: subscriptionIdParamsDto,
        },
      },
      controller.getSubscription,
    );
    zodApplication.post(
      '/subscriptions',
      {
        config: { idempotencyRequired: true, ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config },
        schema: {
          summary: 'Create subscription',
          description:
            'Creates a new subscription for the organization. Only one active subscription is allowed. Requires SUBSCRIPTION_MANAGE permission. Send an `X-Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Subscription'],
          body: CreateSubscriptionDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE)],
      },
      controller.createSubscription,
    );
    zodApplication.patch<{ Params: { subscription_id: string } }>(
      '/subscriptions/:subscription_id',
      {
        config: { ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config },
        schema: {
          summary: 'Update subscription',
          description:
            'Updates subscription settings (e.g. cancel at period end). Requires SUBSCRIPTION_MANAGE permission.',
          tags: ['Subscription'],
          params: subscriptionIdParamsDto,
          body: UpdateSubscriptionDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE)],
      },
      controller.updateSubscription,
    );
    zodApplication.post<{ Params: { subscription_id: string } }>(
      '/subscriptions/:subscription_id/change-plan',
      {
        config: { idempotencyRequired: true, ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config },
        schema: {
          summary: 'Change subscription plan',
          description:
            'Upgrades or downgrades the subscription to a different plan. Proration is applied automatically. Requires SUBSCRIPTION_MANAGE permission. Send an `X-Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Subscription'],
          params: subscriptionIdParamsDto,
          body: ChangePlanDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE)],
      },
      controller.changePlan,
    );
    zodApplication.post<{ Params: { subscription_id: string } }>(
      '/subscriptions/:subscription_id/cancel',
      {
        config: { idempotencyRequired: true, ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE)],
        schema: {
          summary: 'Cancel subscription',
          description:
            'Cancels the subscription. By default, access continues until the end of the current billing period. Requires SUBSCRIPTION_MANAGE permission. Send an `X-Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Subscription'],
          params: subscriptionIdParamsDto,
        },
      },
      controller.cancelSubscription,
    );
    zodApplication.post<{ Params: { subscription_id: string } }>(
      '/subscriptions/:subscription_id/resume',
      {
        config: { idempotencyRequired: true, ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE)],
        schema: {
          summary: 'Resume cancelled subscription',
          description:
            'Resumes a subscription that was previously cancelled but has not yet expired. Requires SUBSCRIPTION_MANAGE permission. Send an `X-Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
          tags: ['Subscription'],
          params: subscriptionIdParamsDto,
        },
      },
      controller.resumeSubscription,
    );
  };
}
