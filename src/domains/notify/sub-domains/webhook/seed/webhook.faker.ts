/**
 * Faker generators for the webhook bulk seeder. Callers pass the orchestrator's seeded `faker`
 * so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';
import { BULK_WEBHOOK_EVENT_TYPES } from '@/domains/notify/sub-domains/webhook/webhook-event/seed/webhook-event.faker.js';

/** A generated webhook's subscribed event list (URL and secret are assigned by the bulk seeder). */
export interface BulkWebhookContent {
  /** Event types this endpoint subscribes to (non-empty subset of the catalog). */
  events: string[];
}

/** Builds one fake webhook's subscription list from the provided faker instance. */
export function generateBulkWebhook(faker: Faker): BulkWebhookContent {
  const events = faker.helpers.arrayElements(BULK_WEBHOOK_EVENT_TYPES, { min: 1, max: 4 });
  return { events: [...events] };
}
