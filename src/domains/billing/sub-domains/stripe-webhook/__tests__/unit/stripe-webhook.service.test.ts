import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (_event: Stripe.Event, handler: (databaseHandle: unknown) => Promise<void>) =>
      handler({} as never),
  ),
}));

describe('StripeWebhookService', () => {
  const subscriptionService = {
    syncFromStripeProviderSubscription: vi.fn(),
    markCanceledByStripeProviderSubscriptionId: vi.fn(),
  } as unknown as SubscriptionService;

  const stripeWebhookEventRepository = {
    tryClaimEvent: vi.fn(),
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
  } as unknown as StripeWebhookEventRepository;

  const service = new StripeWebhookService(subscriptionService, stripeWebhookEventRepository);

  const stripeEventCreatedAtSeconds = 1_700_000_000;

  beforeEach(() => {
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockReset();
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockReset();
    vi.mocked(stripeWebhookEventRepository.markFailed).mockReset();
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockReset();
    vi.mocked(subscriptionService.markCanceledByStripeProviderSubscriptionId).mockReset();

    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue('claimed');
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockResolvedValue(undefined);
    vi.mocked(stripeWebhookEventRepository.markFailed).mockResolvedValue(undefined);
  });

  it('skips processing when event id was already claimed', async () => {
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue('processed_duplicate');

    await service.handleEvent({
      id: 'evt_duplicate',
      type: 'customer.subscription.updated',
      created: stripeEventCreatedAtSeconds,
      data: { object: { id: 'sub_123' } },
    } as Stripe.Event);

    expect(subscriptionService.syncFromStripeProviderSubscription).not.toHaveBeenCalled();
    expect(stripeWebhookEventRepository.markProcessed).not.toHaveBeenCalled();
  });

  it('syncs subscription updates from Stripe with event created timestamp', async () => {
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue({
      id: 1,
    } as never);

    const stripeSubscription = {
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      canceled_at: null,
      current_period_start: stripeEventCreatedAtSeconds,
      current_period_end: stripeEventCreatedAtSeconds + 86_400,
    } as unknown as Stripe.Subscription;

    await service.handleEvent({
      id: 'evt_sub',
      type: 'customer.subscription.updated',
      created: stripeEventCreatedAtSeconds,
      data: { object: stripeSubscription },
    } as Stripe.Event);

    expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ status: 'ACTIVE' }),
      new Date(stripeEventCreatedAtSeconds * 1000),
      expect.objectContaining({ databaseHandle: expect.anything() }),
    );
    expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_sub');
  });

  it('marks subscription canceled via subscription service', async () => {
    vi.mocked(subscriptionService.markCanceledByStripeProviderSubscriptionId).mockResolvedValue({
      id: 9,
    } as never);

    await service.handleEvent({
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      created: stripeEventCreatedAtSeconds,
      data: { object: { id: 'sub_456' } },
    } as Stripe.Event);

    expect(subscriptionService.markCanceledByStripeProviderSubscriptionId).toHaveBeenCalledWith(
      'sub_456',
      new Date(stripeEventCreatedAtSeconds * 1000),
      expect.objectContaining({ databaseHandle: expect.anything() }),
    );
    expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_sub_del');
  });

  it('marks event failed when handler throws', async () => {
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.handleEvent({
        id: 'evt_fail',
        type: 'customer.subscription.updated',
        created: stripeEventCreatedAtSeconds,
        data: {
          object: {
            id: 'sub_fail',
            status: 'active',
            cancel_at_period_end: false,
            canceled_at: null,
            current_period_start: stripeEventCreatedAtSeconds,
            current_period_end: stripeEventCreatedAtSeconds + 86_400,
          },
        },
      } as unknown as Stripe.Event),
    ).rejects.toThrow('database unavailable');

    expect(stripeWebhookEventRepository.markFailed).toHaveBeenCalledWith(
      'evt_fail',
      'database unavailable',
    );
  });
});
