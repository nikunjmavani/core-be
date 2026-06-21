import { sql } from 'drizzle-orm';
import { integer, varchar, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { billingSchema } from '@/infrastructure/database/pg-schemas.js';

/**
 * Allowed values for `billing.stripe_webhook_events.processing_status`. Mirrored
 * by the CHECK constraint on the table; update both in lockstep.
 */
export const stripeWebhookProcessingStatuses = [
  'processing',
  'processed',
  'skipped_duplicate',
  'failed',
] as const;

/** Union of {@link stripeWebhookProcessingStatuses} values. */
export type StripeWebhookProcessingStatus = (typeof stripeWebhookProcessingStatuses)[number];

/**
 * Append-only ledger for Stripe webhook event ids (at-least-once delivery).
 * No tenant RLS — system ingress only.
 */
export const stripe_webhook_events = billingSchema.table(
  'stripe_webhook_events',
  {
    stripe_event_id: varchar('stripe_event_id', { length: 255 }).primaryKey(),
    event_type: varchar('event_type', { length: 128 }).notNull(),
    stripe_created_at: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    processing_status: varchar('processing_status', { length: 32 }).notNull().default('processing'),
    failure_reason: text('failure_reason'),
    request_id: varchar('request_id', { length: 255 }),
    attempt_count: integer('attempt_count').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stripe_webhook_events_status_created').on(
      table.processing_status,
      table.stripe_created_at,
    ),
    index('idx_stripe_webhook_events_status_updated').on(table.processing_status, table.updated_at),
    // audit #15: partial index over only the live working set (failed +
    // in-flight processing). The reclaim scan and the failed-count gauge touch
    // exclusively these statuses, while the retention worker prunes the bulk
    // `processed` / `skipped_duplicate` rows — so this index stays tiny even as
    // the ledger grows, keeping the reclaim sort and the capped count index-only
    // instead of scanning every processed row. Predicate kept in lockstep with
    // the reclaim/count repository queries.
    index('idx_stripe_webhook_events_reclaimable')
      .on(table.updated_at)
      .where(sql`${table.processing_status} IN ('failed', 'processing')`),
    check(
      'stripe_webhook_events_processing_status_check',
      sql`${table.processing_status} IN ('processing', 'processed', 'skipped_duplicate', 'failed')`,
    ),
  ],
);

/**
 * Deletion watermark for Stripe subscriptions (BILL-03). Records the
 * `customer.subscription.deleted` event timestamp for a provider subscription id
 * even when no local `billing.subscriptions` row existed yet (delete arrived
 * before create). A later out-of-order `customer.subscription.created` /
 * `.updated` whose event timestamp is at or before the recorded deletion is then
 * refused, so a stale create cannot resurrect entitlement for a subscription
 * Stripe has already canceled. A genuinely newer event (resubscription) is
 * allowed through. No tenant RLS — system ingress only, keyed by the Stripe id.
 */
export const stripe_subscription_tombstones = billingSchema.table(
  'stripe_subscription_tombstones',
  {
    provider_subscription_id: varchar('provider_subscription_id', { length: 255 }).primaryKey(),
    deleted_event_created_at: timestamp('deleted_event_created_at', {
      withTimezone: true,
    }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
