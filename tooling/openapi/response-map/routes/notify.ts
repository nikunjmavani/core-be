/** OpenAPI success responses — notify and stripe webhook. */
import type { ResponseDefinition } from '../building-blocks.js';
import { wrapSuccess } from '../building-blocks.js';
import * as schemas from '../resource-schemas.js';

export const notifyRouteResponses: Record<string, ResponseDefinition> = {
  'GET /api/v1/notify/notifications': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.notificationSchema }, [
      schemas.notificationExample,
    ]),
    example: null,
  },
  'GET /api/v1/notify/notifications/{id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.notificationSchema, schemas.notificationExample),
    example: null,
  },
  'PATCH /api/v1/notify/notifications/{id}/read': {
    statusCode: 200,
    schema: wrapSuccess(schemas.notificationSchema, {
      ...schemas.notificationExample,
      is_read: true,
      read_at: '2026-02-14T10:30:00.000Z',
    }),
    example: null,
  },
  'POST /api/v1/notify/notifications/mark-all-read': {
    statusCode: 200,
    schema: wrapSuccess(schemas.messageSchema, { message: 'All notifications marked as read' }),
    example: null,
  },
  'GET /api/v1/notify/notifications/unread-count': {
    statusCode: 200,
    schema: wrapSuccess(schemas.unreadCountSchema, { unread_count: 5 }),
    example: null,
  },
  'DELETE /api/v1/notify/notifications/{notificationId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },

  // ── Webhook Events ──
  'GET /api/v1/notify/organizations/{id}/webhook-events': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'array', items: schemas.webhookEventSchema },
      schemas.webhookEventExamples,
    ),
    example: null,
  },

  // ── Webhooks ──
  'GET /api/v1/notify/organizations/{id}/webhooks': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.webhookSchema }, [schemas.webhookExample]),
    example: null,
  },
  'GET /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.webhookSchema, schemas.webhookExample),
    example: null,
  },
  'POST /api/v1/notify/organizations/{id}/webhooks': {
    statusCode: 201,
    schema: wrapSuccess(schemas.webhookSchema, schemas.webhookExample),
    example: null,
  },
  'PATCH /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.webhookSchema, schemas.webhookExample),
    example: null,
  },
  'DELETE /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },
  'GET /api/v1/notify/organizations/{id}/webhooks/{webhookId}/delivery-attempts': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.deliveryAttemptSchema }, [
      schemas.deliveryAttemptExample,
    ]),
    example: null,
  },
  'POST /api/v1/notify/organizations/{id}/webhooks/{webhookId}/test': {
    statusCode: 200,
    schema: wrapSuccess(schemas.webhookTestSchema, schemas.webhookTestExample),
    example: null,
  },

  // ── Stripe Webhook ──
  'POST /api/v1/billing/stripe/webhook': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'object', properties: { received: { type: 'boolean' } } },
      { received: true },
    ),
    example: null,
  },
};
