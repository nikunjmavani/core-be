import type { WebhookEvent } from './webhook-event.types.js';

export function serializeWebhookEvent(event: WebhookEvent) {
  return {
    event: event.event,
    description: event.description,
  };
}

export function serializeWebhookEventList(events: WebhookEvent[]) {
  return events.map(serializeWebhookEvent);
}
