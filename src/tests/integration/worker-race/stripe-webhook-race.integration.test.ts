import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type * as StripeClientModule from '@/infrastructure/payment/stripe.client.js';

const retrieveStripeEventMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/payment/stripe.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StripeClientModule>();
  return {
    ...actual,
    retrieveStripeEvent: (...arguments_: unknown[]) => retrieveStripeEventMock(...arguments_),
  };
});

import { sql } from '@/infrastructure/database/connection.js';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';

const PARALLEL_WORKER_COUNT = 10;

describe('Integration: stripe-webhook worker concurrency race', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    retrieveStripeEventMock.mockReset();
  });

  it('processes the same Stripe event id exactly once under parallel workers', async () => {
    const stripeEventId = `evt_race_${randomUUID()}`;
    const eventPayload = {
      id: stripeEventId,
      type: 'account.updated',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    } as Stripe.Event;

    retrieveStripeEventMock.mockResolvedValue(eventPayload);

    const stripeWebhookService = new StripeWebhookService(
      {
        syncFromStripeProviderSubscription: vi.fn(),
        markCanceledByStripeProviderSubscriptionId: vi.fn(),
      } as unknown as SubscriptionService,
      new StripeWebhookEventRepository(),
      // sec-B7: race test fires `account.updated` (not subscription.updated)
      // so the plan-id resolver is never reached. Stub for type safety only.
      { findByStripePriceId: vi.fn() } as never,
    );

    await Promise.allSettled(
      Array.from({ length: PARALLEL_WORKER_COUNT }, (_, index) =>
        processStripeWebhookJob(
          { stripeEventId, requestId: `req-race-${String(index)}` },
          stripeWebhookService,
          `job-race-${String(index)}`,
        ),
      ),
    );

    const processedCountRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM billing.stripe_webhook_events
      WHERE stripe_event_id = ${stripeEventId}
        AND processing_status = 'processed'
    `;

    expect(Number(processedCountRows[0]?.count ?? 0)).toBe(1);
  });
});
