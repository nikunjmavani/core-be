import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { BILLING_PERMISSIONS } from '../../billing.permissions.js';
import type { SubscriptionService } from './subscription.service.js';
import { createSubscriptionController } from './subscription.controller.js';
import { ChangePlanDto, CreateSubscriptionDto, UpdateSubscriptionDto } from './subscription.dto.js';

export function subscriptionRoutes(service: SubscriptionService): FastifyPluginAsync {
  const controller = createSubscriptionController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/subscriptions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ, 'id')],
      },
      controller.listSubscriptions,
    );
    zodApplication.get<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_READ, 'id')],
      },
      controller.getSubscription,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/subscriptions',
      {
        config: { idempotencyRequired: true },
        schema: { body: CreateSubscriptionDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.createSubscription,
    );
    zodApplication.patch<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId',
      {
        schema: { body: UpdateSubscriptionDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.updateSubscription,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/change-plan',
      {
        schema: { body: ChangePlanDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.changePlan,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/cancel',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.cancelSubscription,
    );
    zodApplication.post<{ Params: { id: string; subscriptionId: string } }>(
      '/organizations/:id/subscriptions/:subscriptionId/resume',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE, 'id')],
      },
      controller.resumeSubscription,
    );
  };
}
