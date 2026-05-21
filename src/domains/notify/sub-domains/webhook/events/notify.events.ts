export const NOTIFY_EVENT = {
  WEBHOOK_DELIVERY_REQUESTED: 'notify.webhook_delivery.requested',
} as const;

export type NotifyEventType = (typeof NOTIFY_EVENT)[keyof typeof NOTIFY_EVENT];

export interface WebhookDeliveryRequestedPayload {
  delivery_attempt_id: number;
}
