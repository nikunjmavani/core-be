/**
 * Notify domain seed module — composes the notification and webhook (+ nested delivery-attempt)
 * bulk contributions into the single {@link DomainSeedModule} the bulk orchestrator registers.
 * Has no reference data; depends on `tenancy` (organizations) and `user` (the user pool) being
 * seeded first.
 */
import { notificationSeedContribution } from '@/domains/notify/sub-domains/notification/seed/index.js';
import { webhookSeedContribution } from '@/domains/notify/sub-domains/webhook/seed/index.js';
import { composeContributions, type DomainSeedModule } from '@/scripts/seed/seed-contract.js';

const bulkContribution = composeContributions(
  notificationSeedContribution,
  webhookSeedContribution,
);

/** The notify domain's seed module: bulk notifications + webhooks + webhook delivery attempts. */
export const notifySeedModule: DomainSeedModule = {
  name: 'notify',
  dependsOn: ['tenancy', 'user'],
  seedBulk: bulkContribution.seedBulk,
};
