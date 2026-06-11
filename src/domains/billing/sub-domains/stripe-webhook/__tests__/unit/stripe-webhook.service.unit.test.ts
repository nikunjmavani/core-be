import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import { ConflictError } from '@/shared/errors/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import type { PlanRepository } from '@/domains/billing/sub-domains/plan/plan.repository.js';

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (
      _event: Stripe.Event,
      _repository: unknown,
      handler: (databaseHandle: unknown) => Promise<void>,
    ) => handler({} as never),
  ),
}));

// audit-#13: spy captureMessage (keep all other sentry exports real) so the
// plan↔Stripe drift alert can be asserted.
vi.mock('@/infrastructure/observability/sentry/sentry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/observability/sentry/sentry.js')>()),
  captureMessage: vi.fn(),
}));
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';

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
    createFromStripeWebhookEvent: vi.fn(),
    // sec-B finding #5: existence check used by the webhook service to distinguish
    // stale-event from race-condition when sync returns null.
    existsByStripeProviderSubscriptionId: vi.fn().mockResolvedValue(false),
  } as unknown as SubscriptionService;

  const stripeWebhookEventRepository = {
    tryClaimEvent: vi.fn(),
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
  } as unknown as StripeWebhookEventRepository;

  const planRepository = {
    findByStripePriceId: vi.fn(),
  } as unknown as PlanRepository;

  const service = new StripeWebhookService(
    subscriptionService,
    stripeWebhookEventRepository,
    planRepository,
  );

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
        data: [
          {
            current_period_start: periodStartSeconds,
            current_period_end: periodEndSeconds,
            price: { id: 'price_default_test' },
          },
        ],
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
    // sec-new-D2: markProcessed/markFailed now return boolean (true = row found and updated)
    vi.mocked(stripeWebhookEventRepository.markProcessed).mockResolvedValue(true as never);
    vi.mocked(stripeWebhookEventRepository.markFailed).mockResolvedValue(true as never);
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
      // sec-B #5 split the prior "not_found_or_stale" warning into two distinct logs;
      // neither should fire on the happy sync path.
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        'stripe.webhook.subscription_not_found_will_retry',
      );
      expect(infoSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        'stripe.webhook.subscription_event_stale_skipped',
      );
    });

    it('skips silently when sync returns null AND the row exists (stale event — newer watermark already wins) — sec-B #5', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue(
        null as never,
      );
      vi.mocked(subscriptionService.existsByStripeProviderSubscriptionId).mockResolvedValue(
        true as never,
      );

      await service.handleEvent(buildEvent());

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123' }),
        'stripe.webhook.subscription_event_stale_skipped',
      );
      // The ledger is still marked processed — a stale event is not a processing failure.
      expect(stripeWebhookEventRepository.markProcessed).toHaveBeenCalledWith('evt_1');
    });

    it('throws when sync returns null AND no row exists for a non-`.created` event (race — BullMQ retries) — sec-B #5', async () => {
      // Prior behaviour: warn + silently advance the ledger to processed. That dropped
      // `.updated` events arriving ahead of `.created`, permanently shadowing newer state.
      // Fix: throw so BullMQ retries with backoff; the late `.created` will eventually
      // INSERT the row and the next `.updated` will apply correctly.
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValue(
        null as never,
      );
      vi.mocked(subscriptionService.existsByStripeProviderSubscriptionId).mockResolvedValue(
        false as never,
      );

      await expect(service.handleEvent(buildEvent())).rejects.toThrow(
        /subscription_local_row_missing/,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123' }),
        'stripe.webhook.subscription_not_found_will_retry',
      );
      // The ledger is NOT marked processed — the BullMQ retry will reclaim it.
      expect(stripeWebhookEventRepository.markFailed).toHaveBeenCalledWith(
        'evt_1',
        expect.any(String),
      );
    });

    // sec-B7: handler used to map status / cancel_at_period_end / period
    // boundaries but never the price → plan id. A plan change made directly
    // in Stripe Dashboard would leave local `subscriptions.plan_id` pinned
    // to the old plan; entitlement checks against `plan.features` would
    // therefore continue serving the OLD feature set forever (or until a
    // checkout flow rebuilt the row). Resolve the new price id to a local
    // plan id and include it in the sync payload.
    it('resolves the local plan id from items.data[0].price.id and includes it in the sync payload (sec-B7)', async () => {
      vi.mocked(planRepository.findByStripePriceId).mockResolvedValueOnce({ id: 42 } as never);

      await service.handleEvent(
        buildEvent({
          data: {
            object: buildSubscription({
              items: {
                data: [
                  {
                    current_period_start: periodStartSeconds,
                    current_period_end: periodEndSeconds,
                    price: { id: 'price_pro_monthly' },
                  },
                ],
              },
            }),
          },
        }),
      );

      expect(planRepository.findByStripePriceId).toHaveBeenCalledWith('price_pro_monthly');
      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      expect((payload as { plan_id?: number }).plan_id).toBe(42);
    });

    it('omits plan_id from the sync payload when the price id does not match any catalog row', async () => {
      vi.mocked(planRepository.findByStripePriceId).mockResolvedValueOnce(null as never);

      await service.handleEvent(
        buildEvent({
          data: {
            object: buildSubscription({
              items: {
                data: [
                  {
                    current_period_start: periodStartSeconds,
                    current_period_end: periodEndSeconds,
                    price: { id: 'price_unknown' },
                  },
                ],
              },
            }),
          },
        }),
      );

      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      // No match → keep the existing plan_id untouched (omit from UPDATE SET).
      // A drift-tracking metric is fine here; silently clobbering plan_id
      // to NULL would corrupt every cached entitlement.
      expect((payload as Record<string, unknown>).plan_id).toBeUndefined();
      // audit-#13: the drift is surfaced as a Sentry alert with the offending ids,
      // not just a log line, so operators can reconcile the catalog.
      expect(vi.mocked(captureMessage)).toHaveBeenCalledWith(
        'stripe.webhook.plan_id_resolution_miss',
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({ stripePriceId: 'price_unknown' }),
        }),
      );
    });

    it('omits plan_id when items.data is empty (no price to resolve)', async () => {
      await service.handleEvent(
        buildEvent({
          data: { object: buildSubscription({ items: { data: [] } }) },
        }),
      );

      expect(planRepository.findByStripePriceId).not.toHaveBeenCalled();
      const [, payload] = vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mock
        .calls[0]!;
      expect((payload as Record<string, unknown>).plan_id).toBeUndefined();
    });
  });

  // sec-B9: when `customer.subscription.created` arrives before the local
  // row has been inserted (B2 race — Stripe answers our checkout faster
  // than our HTTP create commits), the handler's UPDATE matches zero rows
  // and the event silently advances to `processed`. The local row never
  // appears and the user's first payment cycle is invisible to entitlement.
  // Fix: on a null sync for `created` ONLY, fall back to INSERT via the
  // service's createFromStripeWebhookEvent path with the resolved plan id.
  describe('subscription created — fallback INSERT (sec-B9)', () => {
    it('inserts via createFromStripeWebhookEvent when sync returns null and event is .created', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValueOnce(
        null as never,
      );
      vi.mocked(planRepository.findByStripePriceId).mockResolvedValueOnce({
        id: 42,
        stripe_price_monthly_id: 'price_pro_monthly',
        stripe_price_yearly_id: null,
      } as never);
      vi.mocked(subscriptionService.createFromStripeWebhookEvent).mockResolvedValueOnce({
        id: 99,
      } as never);

      await service.handleEvent(
        buildEvent({
          type: 'customer.subscription.created',
          data: {
            object: buildSubscription({
              items: {
                data: [
                  {
                    current_period_start: periodStartSeconds,
                    current_period_end: periodEndSeconds,
                    price: { id: 'price_pro_monthly' },
                  },
                ],
              },
            }),
          },
        }),
      );

      expect(subscriptionService.createFromStripeWebhookEvent).toHaveBeenCalledOnce();
      const [args] =
        vi.mocked(subscriptionService.createFromStripeWebhookEvent).mock.calls[0] ?? [];
      expect(args).toMatchObject({
        providerSubscriptionId: 'sub_123',
        planId: 42,
      });
      // The fallback INSERT was logged as a recovery, not a normal sync.
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123' }),
        'stripe.webhook.subscription_inserted_on_created',
      );
    });

    it('does NOT fall back to INSERT when sync returns null for .updated (only created races deserve recovery)', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValueOnce(
        null as never,
      );
      // sec-B #5: .updated arriving ahead of .created → throw to retry. The fallback
      // INSERT remains wired to .created only (the only case where we have enough fields
      // to safely materialise a new row).
      vi.mocked(subscriptionService.existsByStripeProviderSubscriptionId).mockResolvedValueOnce(
        false as never,
      );

      await expect(
        service.handleEvent(buildEvent({ type: 'customer.subscription.updated' })),
      ).rejects.toThrow(/subscription_local_row_missing/);

      expect(subscriptionService.createFromStripeWebhookEvent).not.toHaveBeenCalled();
    });

    it('skips the fallback INSERT on .created when plan_id cannot be resolved (catalog drift)', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockResolvedValueOnce(
        null as never,
      );
      vi.mocked(planRepository.findByStripePriceId).mockResolvedValueOnce(null as never);
      // No plan_id ⇒ the fallback INSERT for .created refuses (insert_skipped_no_plan).
      // The subsequent existsByStripeProviderSubscriptionId check then throws because no
      // row exists. The behaviour the test cares about is: createFromStripeWebhookEvent
      // is NOT called, and the warning is emitted.
      vi.mocked(subscriptionService.existsByStripeProviderSubscriptionId).mockResolvedValueOnce(
        false as never,
      );

      await expect(
        service.handleEvent(buildEvent({ type: 'customer.subscription.created' })),
      ).rejects.toThrow(/subscription_local_row_missing/);

      // Without a local plan id, inserting would violate the NOT NULL FK on
      // billing.subscriptions.plan_id. Log a structured warning so an operator
      // can backfill the price → plan mapping; do not insert a half-broken row.
      expect(subscriptionService.createFromStripeWebhookEvent).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'sub_123' }),
        'stripe.webhook.subscription_created_insert_skipped_no_plan',
      );
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

    // sec-new-D2: markProcessed/markFailed return a boolean so the caller can
    // detect and warn when the ledger row was unexpectedly absent (no row updated).
    it('emits mark_processed.no_row warning when markProcessed returns false (sec-new-D2)', async () => {
      vi.mocked(stripeWebhookEventRepository.markProcessed).mockResolvedValueOnce(false as never);

      await service.handleEvent(buildEvent({ id: 'evt_no_row' }));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_no_row' }),
        'stripe.webhook.mark_processed.no_row',
      );
    });

    it('emits mark_failed.no_row warning when markFailed returns false (sec-new-D2)', async () => {
      vi.mocked(subscriptionService.syncFromStripeProviderSubscription).mockRejectedValue(
        new Error('transient error'),
      );
      vi.mocked(stripeWebhookEventRepository.markFailed).mockResolvedValueOnce(false as never);

      await expect(service.handleEvent(buildEvent({ id: 'evt_fail_no_row' }))).rejects.toThrow(
        'transient error',
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_fail_no_row' }),
        'stripe.webhook.mark_failed.no_row',
      );
    });
  });
});
