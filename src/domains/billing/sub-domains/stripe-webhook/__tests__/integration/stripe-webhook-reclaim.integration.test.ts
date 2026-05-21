import { describe, it, expect, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { stripe_webhook_events } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.schema.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import { STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES } from '@/shared/constants/index.js';

describe('Stripe webhook reclaim — integration', () => {
  const repository = new StripeWebhookEventRepository();
  const stripeEventId = `evt_reclaim_int_${Date.now()}`;

  afterEach(async () => {
    await database
      .delete(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));
  });

  it('sweepReclaimableEvents moves failed rows back to processing', async () => {
    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(),
    });
    await repository.markFailed(stripeEventId, 'synthetic failure');

    const sweepResult = await repository.sweepReclaimableEvents(10);
    expect(sweepResult.reclaimedStripeEventIds).toContain(stripeEventId);

    const rows = await database
      .select({ processing_status: stripe_webhook_events.processing_status })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(rows[0]?.processing_status).toBe('processing');
  });

  it('sweepReclaimableEvents reclaims stuck processing rows past the lease', async () => {
    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(),
    });

    const stuckUpdatedAt = new Date(
      Date.now() - (STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES + 1) * 60_000,
    );
    await database
      .update(stripe_webhook_events)
      .set({ updated_at: stuckUpdatedAt })
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    const sweepResult = await repository.sweepReclaimableEvents(10);
    expect(sweepResult.reclaimedStripeEventIds).toContain(stripeEventId);

    const rows = await database
      .select({
        processing_status: stripe_webhook_events.processing_status,
        attempt_count: stripe_webhook_events.attempt_count,
      })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(rows[0]?.processing_status).toBe('processing');
    expect(rows[0]?.attempt_count).toBeGreaterThanOrEqual(1);
  });

  it('countFailedEvents returns the number of failed ledger rows', async () => {
    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(),
    });
    await repository.markFailed(stripeEventId, 'count probe');

    const failedBeforeReclaim = await repository.countFailedEvents();
    expect(failedBeforeReclaim).toBeGreaterThanOrEqual(1);

    await repository.tryReclaimEvent(stripeEventId);

    const failedAfterReclaim = await repository.countFailedEvents();
    const stillFailedRows = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.processing_status, 'failed'));
    expect(failedAfterReclaim).toBe(stillFailedRows[0]?.count ?? 0);
  });
});
