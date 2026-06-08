import { eventBus } from '@/core/events/event-bus.js';
import { createPendingWebhookDeliveryAttempt } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js';
import {
  NOTIFY_EVENT,
  type WebhookDeliveryRequestedPayload,
} from '@/domains/notify/sub-domains/webhook/events/notify.events.js';

/**
 * Caller input for {@link emitWebhookDeliveryRequested} — identifies the webhook target,
 * the canonical event type, and the JSON body that will be HMAC-signed and POSTed.
 *
 * @remarks
 * sec-N2: `eventKey` is the optional stable id of the upstream logical event
 * (e.g. the Stripe webhook event id). When provided, the repo uses
 * `onConflictDoNothing(webhook_id, event_key)` against the partial unique
 * index so a retry of the same logical event is a no-op against the existing
 * PENDING row rather than producing a duplicate signed POST.
 */
export interface RequestWebhookDeliveryInput {
  webhookId: number;
  eventType: string;
  payload: Record<string, unknown>;
  eventKey?: string;
}

/**
 * Persist a PENDING delivery attempt and emit async delivery via the event bus.
 * Handlers call {@link enqueueWebhookDeliveryByAttemptId} — not domain services directly.
 */
export async function emitWebhookDeliveryRequested(
  input: RequestWebhookDeliveryInput,
): Promise<void> {
  const delivery_attempt_id = await createPendingWebhookDeliveryAttempt(input);
  const payload: WebhookDeliveryRequestedPayload = { delivery_attempt_id };
  await eventBus.emit({
    type: NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED,
    payload,
    timestamp: new Date(),
  });
}
