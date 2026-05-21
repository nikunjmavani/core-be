/** OpenAPI route metadata — billing and notify. */
import type { RouteMetadata } from './types.js';

export const billingNotifyMetadata: Record<string, RouteMetadata> = {
  // ── Stripe Webhook ──
  'POST /api/v1/billing/stripe/webhook': {
    summary: 'Stripe webhook receiver',
    description:
      'Public endpoint for Stripe billing events. Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` and enqueues durable processing. Raw JSON body is required for signature verification.',
    tags: ['Billing', 'Stripe Webhook'],
  },

  // ── Plans (Billing) ──
  'GET /api/v1/billing/plans': {
    summary: 'List available plans',
    description:
      'Returns all active subscription plans with pricing and feature details. Requires authentication.',
    tags: ['Billing', 'Plan'],
  },
  'GET /api/v1/billing/plans/{id}': {
    summary: 'Get plan details',
    description:
      'Returns a single plan with full pricing and feature information. Requires authentication.',
    tags: ['Billing', 'Plan'],
  },

  // ── Subscriptions ──
  'GET /api/v1/billing/organizations/{id}/subscriptions': {
    summary: 'List subscriptions',
    description:
      'Returns all subscriptions for the organization. Requires SUBSCRIPTION_READ permission.',
    tags: ['Billing', 'Subscription'],
  },
  'GET /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}': {
    summary: 'Get subscription',
    description:
      'Returns a single subscription with its current status. Requires SUBSCRIPTION_READ permission.',
    tags: ['Billing', 'Subscription'],
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions': {
    summary: 'Create subscription',
    description:
      'Creates a new subscription for the organization. Only one active subscription is allowed. Requires SUBSCRIPTION_MANAGE permission. Send an `Idempotency-Key` header (min 16 characters) on this write — the key is forwarded to Stripe when billing is configured. See docs/reference/reliability/idempotency.md.',
    tags: ['Billing', 'Subscription'],
  },
  'PATCH /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}': {
    summary: 'Update subscription',
    description:
      'Updates subscription settings (e.g. cancel at period end). Requires SUBSCRIPTION_MANAGE permission.',
    tags: ['Billing', 'Subscription'],
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/change-plan': {
    summary: 'Change subscription plan',
    description:
      'Upgrades or downgrades the subscription to a different plan. Proration is applied automatically. Requires SUBSCRIPTION_MANAGE permission.',
    tags: ['Billing', 'Subscription'],
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/cancel': {
    summary: 'Cancel subscription',
    description:
      'Cancels the subscription. By default, access continues until the end of the current billing period. Requires SUBSCRIPTION_MANAGE permission.',
    tags: ['Billing', 'Subscription'],
  },
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/resume': {
    summary: 'Resume cancelled subscription',
    description:
      'Resumes a subscription that was previously cancelled but has not yet expired. Requires SUBSCRIPTION_MANAGE permission.',
    tags: ['Billing', 'Subscription'],
  },

  // ── Notifications ──
  'GET /api/v1/notify/notifications': {
    summary: 'List my notifications',
    description: 'Returns a paginated list of notifications for the authenticated user.',
    tags: ['Notification'],
  },
  'GET /api/v1/notify/notifications/{id}': {
    summary: 'Get notification',
    description: 'Returns a single notification by ID.',
    tags: ['Notification'],
  },
  'PATCH /api/v1/notify/notifications/{id}/read': {
    summary: 'Mark notification as read',
    description: 'Marks a single notification as read.',
    tags: ['Notification'],
  },
  'POST /api/v1/notify/notifications/mark-all-read': {
    summary: 'Mark all notifications as read',
    description: 'Marks all unread notifications as read for the authenticated user.',
    tags: ['Notification'],
  },
  'GET /api/v1/notify/notifications/unread-count': {
    summary: 'Get unread notification count',
    description: 'Returns the count of unread notifications for the authenticated user.',
    tags: ['Notification'],
  },
  'DELETE /api/v1/notify/notifications/{notificationId}': {
    summary: 'Delete notification',
    description: 'Permanently deletes a notification.',
    tags: ['Notification'],
  },

  // ── Webhook Events ──
  'GET /api/v1/notify/organizations/{id}/webhook-events': {
    summary: 'List webhook events',
    description:
      'Returns a list of recent webhook events for the organization. Requires WEBHOOK_READ permission.',
    tags: ['Webhook'],
  },

  // ── Webhooks ──
  'GET /api/v1/notify/organizations/{id}/webhooks': {
    summary: 'List webhooks',
    description:
      'Returns all configured webhooks for the organization. Requires WEBHOOK_READ permission.',
    tags: ['Webhook'],
  },
  'GET /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    summary: 'Get webhook',
    description: 'Returns a single webhook configuration. Requires WEBHOOK_READ permission.',
    tags: ['Webhook'],
  },
  'POST /api/v1/notify/organizations/{id}/webhooks': {
    summary: 'Create webhook',
    description:
      'Creates a new webhook endpoint. Specify the URL and events to subscribe to. Requires WEBHOOK_MANAGE permission.',
    tags: ['Webhook'],
  },
  'PATCH /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    summary: 'Update webhook',
    description:
      'Updates a webhook URL, events, or enabled status. Requires WEBHOOK_MANAGE permission.',
    tags: ['Webhook'],
  },
  'DELETE /api/v1/notify/organizations/{id}/webhooks/{webhookId}': {
    summary: 'Delete webhook',
    description: 'Permanently deletes a webhook endpoint. Requires WEBHOOK_MANAGE permission.',
    tags: ['Webhook'],
  },
  'GET /api/v1/notify/organizations/{id}/webhooks/{webhookId}/delivery-attempts': {
    summary: 'List webhook delivery attempts',
    description:
      'Returns the delivery attempt history for a webhook, including status codes and response times. Requires WEBHOOK_READ permission.',
    tags: ['Webhook'],
  },
  'POST /api/v1/notify/organizations/{id}/webhooks/{webhookId}/test': {
    summary: 'Send test webhook',
    description:
      'Sends a test event to the webhook URL to verify connectivity. Requires WEBHOOK_MANAGE permission.',
    tags: ['Webhook'],
  },
};
