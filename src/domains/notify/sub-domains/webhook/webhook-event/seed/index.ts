/**
 * Webhook delivery-attempt nested seed contribution — bulk delivery attempts in mixed states for
 * each bulk-seeded webhook. Composed up into the webhook sub-domain's contribution (after the
 * webhooks themselves) via {@link composeContributions}.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedWebhookEventsBulk } from './webhook-event.bulk.seed.js';

/** Bulk-only nested contribution that fills `webhook_delivery_attempts` for bulk webhooks. */
export const webhookEventContribution: SeedContribution = {
  seedBulk: seedWebhookEventsBulk,
};
