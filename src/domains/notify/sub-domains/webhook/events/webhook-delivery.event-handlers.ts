import { eventBus, type DomainEvent } from '@/core/events/event-bus.js';
import { enqueueWebhookDeliveryByAttemptId } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { findOrganizationPublicIdByDeliveryAttemptId } from '@/domains/notify/sub-domains/webhook/webhook-delivery.repository.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { NOTIFY_EVENT, type WebhookDeliveryRequestedPayload } from './notify.events.js';

async function onWebhookDeliveryRequestedEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as WebhookDeliveryRequestedPayload;
  try {
    const organization_public_id = await findOrganizationPublicIdByDeliveryAttemptId(
      payload.delivery_attempt_id,
    );
    if (!organization_public_id) {
      throw new Error(
        `webhook.delivery.organization_not_found:${String(payload.delivery_attempt_id)}`,
      );
    }
    const enqueueDelivery = () =>
      event.requestId === undefined
        ? enqueueWebhookDeliveryByAttemptId(payload.delivery_attempt_id, organization_public_id)
        : enqueueWebhookDeliveryByAttemptId(
            payload.delivery_attempt_id,
            organization_public_id,
            event.requestId,
          );
    eventBus.onCommit(enqueueDelivery);
  } catch (error) {
    logger.warn(
      { error, eventType: event.type, deliveryAttemptId: payload.delivery_attempt_id },
      'notify.webhook_delivery.enqueue.failed',
    );
  }
}

let webhookDeliveryEventHandlersRegistered = false;

/**
 * Idempotent registrar that subscribes the in-process listener for
 * {@link NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED} so emitting that event (after persisting a
 * pending attempt) results in a BullMQ delivery job once the surrounding transaction commits.
 */
export function registerWebhookDeliveryEventHandlers(): void {
  if (webhookDeliveryEventHandlersRegistered) return;
  webhookDeliveryEventHandlersRegistered = true;
  eventBus.on(NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED, onWebhookDeliveryRequestedEvent);
}
