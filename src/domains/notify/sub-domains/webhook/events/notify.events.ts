/**
 * Catalog of in-process event-bus codes published by the notify domain. Currently a single
 * code that asks the platform to deliver an outbound webhook attempt that has already been
 * persisted in `webhook_delivery_attempts`.
 */
export const NOTIFY_EVENT = {
  WEBHOOK_DELIVERY_REQUESTED: 'notify.webhook_delivery.requested',
} as const;

/** Discriminated union of event codes published under the {@link NOTIFY_EVENT} namespace. */
export type NotifyEventType = (typeof NOTIFY_EVENT)[keyof typeof NOTIFY_EVENT];

/**
 * Payload of {@link NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED}. Only carries the delivery-attempt
 * id; the worker re-reads `(webhook, payload, signing secret)` from Postgres under RLS.
 */
export interface WebhookDeliveryRequestedPayload {
  delivery_attempt_id: number;
}
