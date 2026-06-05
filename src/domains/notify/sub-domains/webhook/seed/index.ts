/**
 * Webhook sub-domain seed contribution — seeds webhook endpoints per organization, then folds in
 * the nested webhook delivery-attempt contribution so attempts seed strictly after the webhooks
 * they reference. Composed up into the notify domain's seed module.
 */
import { webhookEventContribution } from '@/domains/notify/sub-domains/webhook/webhook-event/seed/index.js';
import { composeContributions, type SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedWebhooksBulk } from './webhook.bulk.seed.js';

/** Webhooks first, then their delivery attempts (ordered by {@link composeContributions}). */
const webhookOwnContribution: SeedContribution = {
  seedBulk: seedWebhooksBulk,
};

/** Bulk contribution: webhook endpoints followed by their mixed-state delivery attempts. */
export const webhookSeedContribution: SeedContribution = composeContributions(
  webhookOwnContribution,
  webhookEventContribution,
);
