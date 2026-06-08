import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import type { StripeWebhookJobData } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

// sec-r4-Q1 regression: parseBullMQJobData must NOT be called by the processor.
// Validation belongs at the worker boundary (parseJobDataOrDeadLetter in
// stripe-webhook.worker.ts); a second parse here would bypass DLQ routing.
const parseBullMQJobDataSpy = vi.fn();
vi.mock('@/shared/utils/validation/bullmq-job-validation.util.js', () => ({
  parseBullMQJobData: parseBullMQJobDataSpy,
}));

const retrieveStripeEventMock = vi.fn();

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  retrieveStripeEvent: (...arguments_: unknown[]) => retrieveStripeEventMock(...arguments_),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (_event: Stripe.Event, handler: (databaseHandle: unknown) => Promise<void>) =>
      handler({} as never),
  ),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('stripe-webhook.processor duplicate job delivery', () => {
  const jobData: StripeWebhookJobData = {
    stripeEventId: 'evt_race_duplicate',
    requestId: 'req-race-1',
  };

  const stripeEventPayload = {
    id: 'evt_race_duplicate',
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

  const subscriptionService = {
    syncFromStripeProviderSubscription: vi.fn(),
    markCanceledByStripeProviderSubscriptionId: vi.fn(),
  } as unknown as SubscriptionService;

  const stripeWebhookEventRepository = {
    tryClaimEvent: vi.fn(),
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
  } as unknown as StripeWebhookEventRepository;

  const stripeWebhookService = new StripeWebhookService(
    subscriptionService,
    stripeWebhookEventRepository,
    // sec-B7: processor test exercises retry / DLQ paths, never reaches
    // plan-id resolution. Stub for type safety only.
    { findByStripePriceId: vi.fn() } as never,
  );

  beforeEach(() => {
    retrieveStripeEventMock.mockReset();
    retrieveStripeEventMock.mockResolvedValue(stripeEventPayload);

    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockReset();
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockReset();
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockReset();
    parseBullMQJobDataSpy.mockReset();

    // sec-new-D2: markProcessed now returns boolean; true = row found and updated.
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockResolvedValue(true as never);
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue({
      id: 1,
    } as never);
  });

  // sec-r4-Q1: processor must use jobData directly — no redundant re-parse.
  it('does not re-invoke parseBullMQJobData (validation belongs at worker boundary)', async () => {
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValueOnce('claimed');

    await processStripeWebhookJob(jobData, stripeWebhookService, 'job-noreparse');

    expect(parseBullMQJobDataSpy).not.toHaveBeenCalled();
    expect(retrieveStripeEventMock).toHaveBeenCalledWith(jobData.stripeEventId);
  });

  it('parallel duplicate BullMQ jobs apply subscription side effects only once', async () => {
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent)
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce('processed_duplicate');

    await Promise.all([
      processStripeWebhookJob(jobData, stripeWebhookService, 'job-duplicate-a'),
      processStripeWebhookJob(jobData, stripeWebhookService, 'job-duplicate-b'),
    ]);

    expect(retrieveStripeEventMock).toHaveBeenCalledTimes(2);
    expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledTimes(1);
    expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledTimes(1);
  });
});
