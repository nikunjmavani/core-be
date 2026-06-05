import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import { ConflictError } from '@/shared/errors/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (_event: Stripe.Event, handler: (databaseHandle: unknown) => Promise<void>) =>
      handler({} as never),
  ),
}));

/**
 * Mutation-hardened to ~97% (Stryker, scoped). The one residual survivor is an equivalent
 * mutant: emptying the `statusMap` object literal cannot change behaviour, because every key
 * maps to exactly its own `.toUpperCase()` and the lookup already falls back to
 * `status.toUpperCase()` — so `statusMap[x] ?? x.toUpperCase()` and `{} [x] ?? x.toUpperCase()`
 * produce identical output for every Stripe status. Not worth contorting the map to kill.
 */

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
  const periodStartSeconds = 1_700_000_500;
  const periodEndSeconds = 1_700_086_900;

  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  function buildSubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
    return {
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      canceled_at: null,
      items: {
        data: [{ current_period_start: periodStartSeconds, current_period_end: periodEndSeconds }],
      },
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  // Stripe.Event is a large discriminated union; tests build minimal shapes, so accept a loose
  // override bag and widen through `unknown` rather than fighting the union per event type.
  function buildEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
    return {
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: stripeEventCreatedAtSeconds,
      data: { object: buildSubscription() },
      ...overrides,
    } as unknown as Stripe.Event;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue('claimed');
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockResolvedValue(undefined);
    vi.mocked(stripeWebhookEventRepository.markFailed).mockResolvedValue(undefined);
    vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue({
      id: 1,
    } as never);
    vi.mocked(subscriptionService.markCanceledByStripeProviderSubscriptionId).mockResolvedValue({
      id: 9,
    } as never);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger as never);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('event claim / idempotency', () => {
    it('claims the event id with its type, created timestamp, and request id', async () => {
      await service.handleEvent(buildEvent({ id: 'evt_claim' }), { requestId: 'req_42' });

      expect(stripeWebhookEventRepository.tryClaimEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_event_id: 'evt_claim',
          event_type: 'customer.subscription.updated',
          stripe_created_at: new Date(stripeEventCreatedAtSeconds * 1000),
          request_id: 'req_42',
        }),
      );
    });

    it('skips processing and never marks processed when the event was already handled', async () => {
      vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue(
        'processed_duplicate',
      );

      await service.handleEvent(buildEvent({ id: 'evt_dupe' }));

      expect(subscriptionService.syncFromStripeProviderSubscription).not.toHaveBeenCalled();
      expect(stripeWebhookEventRepository.markProcessed).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_dupe' }),
        'stripe.webhook.duplicate_skipped',
      );
    });

    it('throws ConflictError (so BullMQ retries) when another worker holds the lease', async () => {
      vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue(
        'still_processing_within_lease',
      );

      const error = await service.handleEvent(buildEvent({ id: 'evt_inflight' })).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      // The event id must be carried in the error params (used for the retry log/trace).
      expect((error as ConflictError).messageParams).toEqual({ eventId: 'evt_inflight' });
      // Thrown before the processing try/catch, so it must not touch the ledger as failed.
      expect(stripeWebhookEventRepository.markFailed).not.toHaveBeenCalled();
      expect(subscriptionService.syncFromStripeProviderSubscription).not.toHaveBeenCalled();
    });

    it('processes (and logs) a reclaimed event rather than skipping it', async () => {
      vi.mocked(stripeWebhookEventRepository.tryClaimEvent).mockResolvedValue('reclaimed');

      await service.handleEvent(buildEvent({ id: 'evt_reclaimed' }));

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_reclaimed' }),
        'stripe.webhook.reclaimed',
      );
      expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledTimes(1);
      expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_reclaimed');
    });
  });

  describe('event dispatch', () => {
    it('routes customer.subscription.created through the update handler', async () => {
      await service.handleEvent(buildEvent({ type: 'customer.subscription.created' }));

      expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledTimes(1);
      expect(subscriptionService.markCanceledByStripeProviderSubscriptionId).not.toHaveBeenCalled();
    });

    it('ignores unhandled event types but still marks the ledger processed', async () => {
      await service.handleEvent(
        buildEvent({ type: 'customer.subscription.trial_will_end' as Stripe.Event['type'] }),
      );

      expect(subscriptionService.syncFromStripeProviderSubscription).not.toHaveBeenCalled();
      expect(subscriptionService.markCanceledByStripeProviderSubscriptionId).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'customer.subscription.trial_will_end' }),
        'stripe.webhook.unhandled_event',
      );
      expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_1');
    });
  });

  describe('subscription updated', () => {
    it('maps a known Stripe status and parses both period boundaries from epoch seconds', async () => {
      await service.handleEvent(buildEvent());

      expect(subscriptionService.syncFromStripeProviderSubscription).toHaveBeenCalledWith(
        'sub_123',
        expect.objectContaining({
          status: 'ACTIVE',
          current_period_start: new Date(periodStartSeconds * 1000),
          current_period_end: new Date(periodEndSeconds * 1000),
        }),
        new Date(stripeEventCreatedAtSeconds * 1000),
        expect.objectContaining({ databaseHandle: expect.anything() }),
      );
      // A normally-claimed event must NOT emit the reclaimed log — guards the
      // `claimResult === 'reclaimed'` condition against being forced always-true.
      expect(infoSpy).not.toHaveBeenCalledWith(expect.anything(), 'stripe.webhook.reclaimed');
    });

    it('upper-cases an unmapped status rather than dropping it', async () => {
      await service.handleEvent(
        buildEvent({ data: { object: buildSubscription({ status: 'some_future_status' }) } }),
      );

      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      expect((payload as { status: string }).status).toBe('SOME_FUTURE_STATUS');
    });

    it('converts a numeric canceled_at to a Date in epoch milliseconds', async () => {
      const canceledAtSeconds = 1_700_050_000;
      await service.handleEvent(
        buildEvent({
          data: { object: buildSubscription({ canceled_at: canceledAtSeconds }) },
        }),
      );

      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      expect((payload as { canceled_at?: Date }).canceled_at).toEqual(
        new Date(canceledAtSeconds * 1000),
      );
    });

    it('falls back to a valid Date when no subscription item is present (not Invalid Date)', async () => {
      await service.handleEvent(
        buildEvent({
          data: {
            object: buildSubscription({ items: { data: [] } }),
          },
        }),
      );

      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      const { current_period_start, current_period_end } = payload as {
        current_period_start: Date;
        current_period_end: Date;
      };
      // A mutant forcing the `* 1000` branch on a non-number yields `new Date(NaN)`.
      expect(Number.isNaN(current_period_start.getTime())).toBe(false);
      expect(Number.isNaN(current_period_end.getTime())).toBe(false);
    });

    it('logs subscription_synced when the local row was updated', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue({
        id: 5,
      } as never);

      await service.handleEvent(buildEvent());

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123', status: 'ACTIVE' }),
        'stripe.webhook.subscription_synced',
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        'stripe.webhook.subscription_not_found_or_stale',
      );
    });

    it('warns subscription_not_found_or_stale when no row was updated (stale/out-of-order)', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue(
        null as never,
      );

      await service.handleEvent(buildEvent());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123' }),
        'stripe.webhook.subscription_not_found_or_stale',
      );
      // The ledger is still marked processed — a missing row is not a processing failure.
      expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_1');
    });
  });

  describe('subscription deleted', () => {
    const deletedEvent = (object: Record<string, unknown> = { id: 'sub_456' }): Stripe.Event =>
      ({
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        created: stripeEventCreatedAtSeconds,
        data: { object },
      }) as unknown as Stripe.Event;

    it('cancels the subscription with the event created timestamp', async () => {
      await service.handleEvent(deletedEvent());

      expect(subscriptionService.markCanceledByStripeProviderSubscriptionId).toHaveBeenCalledWith(
        'sub_456',
        new Date(stripeEventCreatedAtSeconds * 1000),
        expect.objectContaining({ databaseHandle: expect.anything() }),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_456' }),
        'stripe.webhook.subscription_canceled',
      );
    });

    it('warns cancel_stale_or_missing when no row matched the deletion', async () => {
      vi.mocked(subscriptionService.markCanceledByStripeProviderSubscriptionId).mockResolvedValue(
        null as never,
      );

      await service.handleEvent(deletedEvent());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_456' }),
        'stripe.webhook.subscription_cancel_stale_or_missing',
      );
      expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_del');
    });
  });

  describe('failure handling', () => {
    it('marks the ledger row failed with the error message and rethrows for retry', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(service.handleEvent(buildEvent({ id: 'evt_fail' }))).rejects.toThrow(
        'database unavailable',
      );

      expect(stripeWebhookEventRepository.markFailed).toHaveBeenCalledWith(
        'evt_fail',
        'database unavailable',
      );
      expect(stripeWebhookEventRepository.markProcessed).not.toHaveBeenCalled();
    });

    it('stringifies a non-Error throw value when recording the failure reason', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockRejectedValue(
        'plain string failure',
      );

      await expect(service.handleEvent(buildEvent({ id: 'evt_fail_str' }))).rejects.toBe(
        'plain string failure',
      );

      expect(stripeWebhookEventRepository.markFailed).toHaveBeenCalledWith(
        'evt_fail_str',
        'plain string failure',
      );
    });
  });
});
