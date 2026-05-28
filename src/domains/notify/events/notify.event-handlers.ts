import { registerWebhookDeliveryEventHandlers } from '@/domains/notify/sub-domains/webhook/events/webhook-delivery.event-handlers.js';

let notifyEventHandlersRegistered = false;

/**
 * Aggregate registrar that wires every notify-domain event handler exactly once
 * (idempotent — safe to call from `notify.container` and from boot paths).
 */
export function registerNotifyEventHandlers(): void {
  if (notifyEventHandlersRegistered) return;
  notifyEventHandlersRegistered = true;
  registerWebhookDeliveryEventHandlers();
}
