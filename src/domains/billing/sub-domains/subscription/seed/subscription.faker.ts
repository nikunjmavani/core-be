/**
 * Faker generators for the subscription bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`. Status and billing cycle are chosen by
 * the bulk seeder (status is constrained by the schema's partial unique index), not here.
 */
import type { Faker } from '@faker-js/faker';

/** Billing cycle values allowed by the `chk_subs_cycle` check constraint. */
export const BULK_BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;

/** A generated subscription's billing window and cycle. */
export interface BulkSubscriptionWindow {
  /** Billing cycle (`MONTHLY` or `YEARLY`). */
  billing_cycle: (typeof BULK_BILLING_CYCLES)[number];
  /** Start of the current billing period. */
  current_period_start: Date;
  /** End of the current billing period (always after the start, per `chk_subs_period`). */
  current_period_end: Date;
}

/**
 * Builds one subscription's billing window from the provided faker instance: a random recent
 * start date plus a period length matching the chosen cycle (1 month or 1 year).
 */
export function generateBulkSubscriptionWindow(faker: Faker): BulkSubscriptionWindow {
  const billing_cycle = faker.helpers.arrayElement(BULK_BILLING_CYCLES);
  const current_period_start = faker.date.recent({ days: 30 });
  const current_period_end = new Date(current_period_start);
  if (billing_cycle === 'YEARLY') {
    current_period_end.setFullYear(current_period_end.getFullYear() + 1);
  } else {
    current_period_end.setMonth(current_period_end.getMonth() + 1);
  }
  return { billing_cycle, current_period_start, current_period_end };
}
