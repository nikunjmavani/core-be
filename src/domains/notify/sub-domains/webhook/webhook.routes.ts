import type { FastifyPluginAsync } from 'fastify';
import {
  ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit-presets.constants.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { NOTIFY_PERMISSIONS } from '../../notify.permissions.js';
import type { WebhookService } from './webhook.service.js';
import type { WebhookEventService } from './webhook-event/webhook-event.service.js';
import { createWebhookController } from './webhook.controller.js';
import { createWebhookEventController } from './webhook-event/webhook-event.controller.js';

export function webhookRoutes(
  webhookService: WebhookService,
  webhookEventService: WebhookEventService,
): FastifyPluginAsync {
  const webhookController = createWebhookController(webhookService);
  const webhookEventController = createWebhookEventController(webhookEventService);

  return async (app) => {
    app.get<{ Params: { id: string } }>(
      '/organizations/:id/webhook-events',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
      },
      webhookEventController.listWebhookEvents,
    );
    app.get<{ Params: { id: string } }>(
      '/organizations/:id/webhooks',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
      },
      webhookController.listWebhooks,
    );
    app.get<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
      },
      webhookController.getWebhook,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/webhooks',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
      },
      webhookController.createWebhook,
    );
    app.patch<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
      },
      webhookController.updateWebhook,
    );
    app.delete<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
      },
      webhookController.deleteWebhook,
    );
    app.get<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId/delivery-attempts',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
      },
      webhookController.listDeliveryAttempts,
    );
    app.post<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId/test',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...STRICT_AUTHED_RATE_LIMIT,
      },
      webhookController.testWebhook,
    );
  };
}
