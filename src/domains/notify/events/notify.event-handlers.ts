import { registerWebhookDeliveryEventHandlers } from '@/domains/notify/sub-domains/webhook/events/webhook-delivery.event-handlers.js';

let notifyEventHandlersRegistered = false;

export function registerNotifyEventHandlers(): void {
  if (notifyEventHandlersRegistered) return;
  notifyEventHandlersRegistered = true;
  registerWebhookDeliveryEventHandlers();
}
