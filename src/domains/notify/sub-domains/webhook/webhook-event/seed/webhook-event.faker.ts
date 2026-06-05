/**
 * Faker generators for the webhook delivery-attempt bulk seeder. Callers pass the
 * orchestrator's seeded `faker` so output is reproducible for a given `SEED`.
 *
 * Persistence note: the `webhook-event` nested sub-domain exposes a static catalog with no
 * table, so the seedable "webhook events in mixed delivery states" are rows of
 * `notify.webhook_delivery_attempts` — the immutable outbound-delivery audit trail tied to the
 * parent webhook.
 */
import type { Faker } from '@faker-js/faker';

/** Event types a delivery attempt can carry (mirrors the dispatchable webhook event catalog). */
export const BULK_WEBHOOK_EVENT_TYPES = [
  'organization.created',
  'organization.updated',
  'membership.created',
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
] as const;

/** A generated delivery attempt's content fields (status/ids are assigned by the bulk seeder). */
export interface BulkWebhookEventContent {
  /** The event type that triggered the delivery. */
  event_type: string;
  /** JSON payload that would have been POSTed to the endpoint. */
  payload: Record<string, unknown>;
}

/** Builds one fake delivery attempt's event type + payload from the provided faker instance. */
export function generateBulkWebhookEvent(faker: Faker): BulkWebhookEventContent {
  const event_type = faker.helpers.arrayElement(BULK_WEBHOOK_EVENT_TYPES);
  return {
    event_type,
    payload: {
      event: event_type,
      id: faker.string.uuid(),
      occurred_at: faker.date.recent({ days: 30 }).toISOString(),
    },
  };
}
