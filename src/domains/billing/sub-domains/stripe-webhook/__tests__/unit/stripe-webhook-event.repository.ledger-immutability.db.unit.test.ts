import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { database } from '@/infrastructure/database/connection.js';
import { stripe_webhook_events } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.schema.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import {
  MILLISECONDS_PER_MINUTE,
  STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES,
} from '@/shared/constants/index.js';

describe('StripeWebhookEventRepository ledger immutability (database)', () => {
  const repository = new StripeWebhookEventRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('does not transition processed event back to processing (idempotent re-claim returns existing processed row)', async () => {
    const stripeEventId = 'evt_ledger_processed_replay';
    const stripeCreatedAt = new Date('2026-04-01T00:00:00.000Z');

    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
    });
    await repository.markProcessed(stripeEventId);

    const replayClaim = await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
    });

    expect(replayClaim).toBe('processed_duplicate');

    const rows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_status).toBe('processed');
    expect(rows[0]?.processed_at).toBeTruthy();
  });

  it('does not change ledger payload after status=processed', async () => {
    const stripeEventId = 'evt_ledger_payload_frozen';
    const originalEventType = 'invoice.payment_succeeded';
    const originalStripeCreatedAt = new Date('2026-04-01T00:00:00.000Z');

    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: originalEventType,
      stripe_created_at: originalStripeCreatedAt,
      request_id: 'req-original',
    });
    await repository.markProcessed(stripeEventId);

    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.deleted',
      stripe_created_at: new Date('2026-05-15T12:00:00.000Z'),
      request_id: 'req-replay',
    });

    const rows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(rows[0]?.event_type).toBe(originalEventType);
    expect(rows[0]?.stripe_created_at?.toISOString()).toBe(originalStripeCreatedAt.toISOString());
    expect(rows[0]?.request_id).toBe('req-original');
    expect(rows[0]?.processing_status).toBe('processed');
  });

  it('skipped_duplicate rows are retained until retention worker purges them', async () => {
    const stripeEventId = 'evt_ledger_skipped_duplicate';
    const stripeCreatedAt = new Date('2026-04-01T00:00:00.000Z');

    await database.insert(stripe_webhook_events).values({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.created',
      stripe_created_at: stripeCreatedAt,
      processing_status: 'skipped_duplicate',
      attempt_count: 1,
    });

    const replayClaim = await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.created',
      stripe_created_at: stripeCreatedAt,
    });

    expect(replayClaim).toBe('still_processing_within_lease');

    const reclaimable = await repository.findReclaimableStripeEventIds(50);
    expect(reclaimable).not.toContain(stripeEventId);

    const persisted = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.processing_status).toBe('skipped_duplicate');
  });

  it('reclaim does not pick up rows in processed status', async () => {
    const processedEventId = 'evt_ledger_reclaim_skip_processed';

    await repository.tryClaimEvent({
      stripe_event_id: processedEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date('2026-04-01T00:00:00.000Z'),
    });
    await repository.markProcessed(processedEventId);

    const reclaimed = await repository.tryReclaimEvent(processedEventId);
    expect(reclaimed).toBe(false);

    const sweepResult = await repository.sweepReclaimableEvents(50);
    expect(sweepResult.reclaimedStripeEventIds).not.toContain(processedEventId);

    const rows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, processedEventId));
    expect(rows[0]?.processing_status).toBe('processed');
  });

  it('reclaim picks up rows stuck in processing past lease timeout', async () => {
    const stuckEventId = 'evt_ledger_reclaim_stuck_processing';
    const stripeCreatedAt = new Date('2026-04-01T00:00:00.000Z');

    await repository.tryClaimEvent({
      stripe_event_id: stuckEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
    });

    const pastLease = new Date(
      Date.now() - (STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES + 5) * MILLISECONDS_PER_MINUTE,
    );
    await database
      .update(stripe_webhook_events)
      .set({ updated_at: pastLease })
      .where(eq(stripe_webhook_events.stripe_event_id, stuckEventId));

    const reclaimableIds = await repository.findReclaimableStripeEventIds(50);
    expect(reclaimableIds).toContain(stuckEventId);

    const sweepResult = await repository.sweepReclaimableEvents(50);
    expect(sweepResult.reclaimedStripeEventIds).toContain(stuckEventId);

    const rows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stuckEventId));
    expect(rows[0]?.processing_status).toBe('processing');
    expect(rows[0]?.attempt_count).toBe(1);
    expect(rows[0]?.failure_reason).toBeNull();
  });
});
