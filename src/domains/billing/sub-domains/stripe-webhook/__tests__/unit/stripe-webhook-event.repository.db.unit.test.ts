import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { stripe_webhook_events } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.schema.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

describe('StripeWebhookEventRepository', () => {
  const repository = new StripeWebhookEventRepository();
  const stripeEventId = `evt_test_${Date.now()}`;

  afterEach(async () => {
    await database
      .delete(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));
  });

  it('claims a new event, reclaims the durable ingress row, then treats fresh processing as in-flight', async () => {
    const stripeCreatedAt = new Date('2026-01-15T12:00:00.000Z');

    const firstClaim = await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
      request_id: 'req-1',
    });

    const secondClaim = await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
      request_id: 'req-2',
    });

    const thirdClaim = await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
      request_id: 'req-3',
    });

    expect(firstClaim).toBe('claimed');
    expect(secondClaim).toBe('reclaimed');
    expect(thirdClaim).toBe('still_processing_within_lease');
  });

  it('returns processed_duplicate after the event is marked processed', async () => {
    const stripeCreatedAt = new Date('2026-01-15T12:00:00.000Z');
    const processedEventId = `${stripeEventId}_processed`;

    await repository.tryClaimEvent({
      stripe_event_id: processedEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
    });
    await repository.markProcessed(processedEventId);

    const duplicateClaim = await repository.tryClaimEvent({
      stripe_event_id: processedEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: stripeCreatedAt,
    });

    expect(duplicateClaim).toBe('processed_duplicate');

    await database
      .delete(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, processedEventId));
  });

  it('marks processed and failed states', async () => {
    await repository.tryClaimEvent({
      stripe_event_id: stripeEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(),
    });

    await repository.markProcessed(stripeEventId);

    const processedRows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(processedRows[0]?.processing_status).toBe('processed');
    expect(processedRows[0]?.processed_at).toBeTruthy();

    await repository.markFailed(stripeEventId, 'synthetic failure');

    const failedRows = await database
      .select()
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, stripeEventId));

    expect(failedRows[0]?.processing_status).toBe('failed');
    expect(failedRows[0]?.failure_reason).toBe('synthetic failure');
  });

  // audit #15: the capped count query (LIMIT sub-select) still returns the live
  // failed tally end-to-end against the partial index.
  it('countFailedEvents tallies failed ledger rows', async () => {
    const failedEventId = `${stripeEventId}_count_failed`;
    await repository.tryClaimEvent({
      stripe_event_id: failedEventId,
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(),
    });
    await repository.markFailed(failedEventId, 'synthetic failure for count');

    const failedCount = await repository.countFailedEvents();
    expect(failedCount).toBeGreaterThanOrEqual(1);

    await database
      .delete(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, failedEventId));
  });

  // audit #2: the SECURITY DEFINER customer resolver is wired and granted; an
  // unmapped customer id resolves to undefined so the webhook handler fails
  // closed rather than trusting attacker-influencable metadata.
  it('resolveOrganizationPublicIdByStripeCustomerId returns undefined for an unmapped customer', async () => {
    const resolved = await repository.resolveOrganizationPublicIdByStripeCustomerId(
      `cus_unmapped_${Date.now()}`,
    );
    expect(resolved).toBeUndefined();
  });
});
