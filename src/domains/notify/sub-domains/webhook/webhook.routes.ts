import type { FastifyPluginAsync } from 'fastify';
import {
  ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit-presets.constants.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { rejectLegacyPagePagination } from '@/shared/utils/http/pagination.util.js';
import { NOTIFY_PERMISSIONS } from '../../notify.permissions.js';
import type { WebhookService } from './webhook.service.js';
import type { WebhookEventService } from './webhook-event/webhook-event.service.js';
import { createWebhookController } from './webhook.controller.js';
import { createWebhookEventController } from './webhook-event/webhook-event.controller.js';
import { listWebhookDeliveryAttemptsQueryDto, listWebhooksQueryDto } from './webhook.dto.js';

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
        schema: {
          summary: 'List webhook events',
          description:
            'Returns a list of recent webhook events for the organization. Requires WEBHOOK_READ permission.',
          tags: ['Webhook'],
        },
      },
      webhookEventController.listWebhookEvents,
    );
    app.get<{ Params: { id: string } }>(
      '/organizations/:id/webhooks',
      {
        schema: {
          summary: 'List webhooks',
          description:
            'Returns all configured webhooks for the organization. Requires WEBHOOK_READ permission.',
          tags: ['Webhook'],
          querystring: listWebhooksQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
      },
      webhookController.listWebhooks,
    );
    app.get<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_READ, 'id')],
        schema: {
          summary: 'Get webhook',
          description: 'Returns a single webhook configuration. Requires WEBHOOK_READ permission.',
          tags: ['Webhook'],
        },
      },
      webhookController.getWebhook,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/webhooks',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
        schema: {
          summary: 'Create webhook',
          description:
            'Creates a new webhook endpoint. Specify the URL and events to subscribe to. Requires WEBHOOK_MANAGE permission.',
          tags: ['Webhook'],
        },
      },
      webhookController.createWebhook,
    );
    app.patch<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
        schema: {
          summary: 'Update webhook',
          description:
            'Updates a webhook URL, events, or enabled status. Requires WEBHOOK_MANAGE permission.',
          tags: ['Webhook'],
        },
      },
      webhookController.updateWebhook,
    );
    app.delete<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(NOTIFY_PERMISSIONS.WEBHOOK_MANAGE, 'id')],
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
        schema: {
          summary: 'Delete webhook',
          description:
            'Permanently deletes a webhook endpoint. Requires WEBHOOK_MANAGE permission.',
          tags: ['Webhook'],
        },
      },
      webhookController.deleteWebhook,
    );
    app.get<{ Params: { id: string; webhookId: string } }>(
      '/organizations/:id/webhooks/:webhookId/delivery-attempts',
      {
        schema: {
          summary: 'List webhook delivery attempts',
          description:
            'Returns the delivery attempt history for a webhook, including status codes and response times. Requires WEBHOOK_READ permission.',
          tags: ['Webhook'],
          querystring: listWebhookDeliveryAttemptsQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
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
        schema: {
          summary: 'Send test webhook',
          description:
            'Sends a test event to the webhook URL to verify connectivity. Requires WEBHOOK_MANAGE permission.',
          tags: ['Webhook'],
        },
      },
      webhookController.testWebhook,
    );
  };
}
