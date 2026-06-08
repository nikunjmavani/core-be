import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import type { StripeWebhookJobData } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

const retrieveStripeEventMock = vi.fn();

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  retrieveStripeEvent: (...arguments_: unknown[]) => retrieveStripeEventMock(...arguments_),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (
      _event: Stripe.Event,
      _repository: unknown,
      handler: (databaseHandle: unknown) => Promise<void>,
    ) => handler({} as never),
  ),
}));

describe('stripe-webhook.processor race', () => {
  const jobData: StripeWebhookJobData = {
    stripeEventId: 'evt_race',
    requestId: 'req-race',
  };

  const stripeEventPayload = {
    id: 'evt_race',
    type: 'customer.subscription.updated',
    created: 1_700_000_000,
    data: {
      object: {
        id: 'sub_race',
        status: 'active',
        items: {
          data: [{ current_period_start: 1_700_000_000, current_period_end: 1_700_086_400 }],
        },
      },
    },
  } as unknown as Stripe.Event;

  let subscriptionService: SubscriptionService;
  let stripeWebhookEventRepository: StripeWebhookEventRepository;
  let stripeWebhookService: StripeWebhookService;

  beforeEach(() => {
    retrieveStripeEventMock.mockReset();
    retrieveStripeEventMock.mockResolvedValue(stripeEventPayload);

    subscriptionService = {
      syncFromStripeProviderSubscription: vi.fn().mockResolvedValue({ id: 1 }),
      markCanceledByStripeProviderSubscriptionId: vi.fn(),
    } as unknown as SubscriptionService;

    stripeWebhookEventRepository = {
      tryClaimEvent: vi.fn(),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    } as unknown as StripeWebhookEventRepository;

    stripeWebhookService = new StripeWebhookService(
      subscriptionService,
      stripeWebhookEventRepository,
      // sec-B7: race test asserts only the at-least-once idempotency contract;
      // plan-id resolution is irrelevant. Stub for type safety only.
      { findByStripePriceId: vi.fn() } as never,
    );
  });

  it('processes subscription.updated once when ten workers race the same event id', async () => {
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockImplementation(async () => {
      const callCount = vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mock.calls.length;
      return callCount === 1 ? 'claimed' : 'processed_duplicate';
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        processStripeWebhookJob(jobData, stripeWebhookService, `job-${index}`),
      ),
    );

    expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledTimes(1);
  });
});
