import type { WebhookEvent } from './webhook-event.types.js';

/** Shape a single {@link WebhookEvent} catalog entry into the public `{ event, description }` payload. */
export function serializeWebhookEvent(event: WebhookEvent) {
  return {
    event: event.event,
    description: event.description,
  };
}

/** Shape an array of {@link WebhookEvent} catalog entries via {@link serializeWebhookEvent}. */
export function serializeWebhookEventList(events: WebhookEvent[]) {
  return events.map(serializeWebhookEvent);
}
