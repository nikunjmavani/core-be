import type Stripe from 'stripe';
import type { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import { createWorkerSubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { ConflictError } from '@/shared/errors/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { PlanRepository } from '@/domains/billing/sub-domains/plan/plan.repository.js';
import type { StripeWebhookEventRepository } from './stripe-webhook-event.repository.js';
import { runStripeWebhookHandlerWithOrganizationContext } from './stripe-webhook-organization.util.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';

/** Result row type from PlanRepository.findByStripePriceId; threaded through the sec-B9 fallback. */
type MatchedPlanForCreate = Awaited<ReturnType<PlanRepository['findByStripePriceId']>>;

/**
 * Resolves the local `billing_cycle` ('monthly' | 'yearly') for a Stripe price
 * id by matching against the plan's `stripe_price_*_id` columns. Falls back to
 * 'monthly' when neither column matches — a defensive default for a Stripe
 * dashboard that has only one of the two price ids populated, so the sec-B9
 * fallback INSERT path still creates a row instead of dropping the event. The
 * upstream `customer.subscription.updated` handler will reconcile any actual
 * billing-cycle drift on the next event.
 */
function resolveBillingCycleForStripePrice(
  stripePriceId: string | undefined,
  plan: {
    stripe_price_monthly_id: string | null;
    stripe_price_yearly_id: string | null;
  },
): 'monthly' | 'yearly' {
  if (stripePriceId !== undefined && plan.stripe_price_yearly_id === stripePriceId) {
    return 'yearly';
  }
  return 'monthly';
}

/**
 * Processes Stripe webhook events and syncs subscription state.
 * Plans are managed offline via admin panel — subscription lifecycle events only.
 *
 * @remarks
 * - **Algorithm:** Signature verification has already happened upstream in
 *   `stripeWebhookIngressPlugin` (raw-body HMAC check); this service then
 *   1) claims the event id in {@link StripeWebhookEventRepository.tryClaimEvent}
 *      to enforce at-least-once idempotency, 2) resolves tenancy scope via
 *      {@link runStripeWebhookHandlerWithOrganizationContext} (reads
 *      `organization_id` metadata or `billing.resolve_organization_public_id_for_stripe_subscription`)
 *      so RLS sees `app.current_organization_id`, 3) dispatches by event type
 *      and updates the local subscription row via a worker-scoped repository,
 *      and 4) marks the ledger row `processed`.
 * - **Failure modes:** Returns silently on `processed_duplicate`; throws
 *   {@link ConflictError} on `still_processing_within_lease` so BullMQ retries;
 *   any thrown error marks the ledger row `failed` (truncated reason, up to
 *   2,000 chars) before rethrowing so the worker honours its retry/backoff.
 *   Subscription updates use the `last_stripe_event_created_at` watermark to
 *   discard out-of-order events.
 * - **Side effects:** Writes to `billing.stripe_webhook_events` (always) and
 *   `billing.subscriptions` (on subscription lifecycle events). Logs each
 *   stage; unhandled event types are logged and skipped.
 * - **Notes:** Runs inside {@link withSystemTableWorkerContext} so the ledger
 *   write happens without an organization GUC; the subscription write then
 *   switches into {@link withOrganizationContext} for RLS-safe mutation. The
 *   `customer.subscription.created` race that left a missing local row
 *   silently advancing to `processed` is now recovered by the sec-B9 fallback
 *   INSERT path; see `tryFallbackInsertForCreated`.
 */
export class StripeWebhookService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly stripeWebhookEventRepository: StripeWebhookEventRepository,
    /**
     * Used to resolve `items.data[0].price.id` from a `customer.subscription.updated`
     * event back to the local `plans.id` so Dashboard-driven plan changes flow into
     * `subscriptions.plan_id` (sec-B7). Drift between the Stripe-side plan and the
     * local entitlement column otherwise serves the old `plan.features` set forever
     * — most visible after a customer-service-initiated downgrade.
     */
    private readonly planRepository: PlanRepository,
  ) {}

  /**
   * Dispatch a Stripe event to the appropriate handler (idempotent by event id).
   */
  async handleEvent(event: Stripe.Event, context?: { requestId?: string }): Promise<void> {
    const stripeEventCreatedAt = new Date(event.created * 1000);

    await withSystemTableWorkerContext(async () => {
      const claimResult = await this.stripeWebhookEventRepository.tryClaimEvent(
        omitUndefined({
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_created_at: stripeEventCreatedAt,
          request_id: context?.requestId,
        }),
      );

      if (claimResult === 'processed_duplicate') {
        logger.info(
          { eventId: event.id, eventType: event.type },
          'stripe.webhook.duplicate_skipped',
        );
        return;
      }

      if (claimResult === 'still_processing_within_lease') {
        throw new ConflictError(
          'errors:stripeWebhookEventInFlight',
          { eventId: event.id },
          `Stripe webhook event ${event.id} is still processing within the lease window`,
        );
      }

      if (claimResult === 'reclaimed') {
        logger.info({ eventId: event.id, eventType: event.type }, 'stripe.webhook.reclaimed');
      }

      try {
        await runStripeWebhookHandlerWithOrganizationContext(
          event,
          this.stripeWebhookEventRepository,
          async (databaseHandle) => {
            const workerSubscriptionRepository = createWorkerSubscriptionRepository(databaseHandle);
            await this.dispatchEvent(event, stripeEventCreatedAt, workerSubscriptionRepository);
          },
        );
        // sec-new-D2: detect no-op writes (ledger row unexpectedly absent)
        const marked = await this.stripeWebhookEventRepository.markProcessed(event.id);
        if (!marked) {
          logger.warn(
            { eventId: event.id, eventType: event.type },
            'stripe.webhook.mark_processed.no_row',
          );
        }
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        // sec-new-D2: detect no-op writes (ledger row unexpectedly absent)
        const marked = await this.stripeWebhookEventRepository.markFailed(event.id, failureReason);
        if (!marked) {
          logger.warn(
            { eventId: event.id, eventType: event.type, failureReason },
            'stripe.webhook.mark_failed.no_row',
          );
        }
        throw error;
      }
    });
  }

  private async dispatchEvent(
    event: Stripe.Event,
    stripeEventCreatedAt: Date,
    subscriptionRepository: SubscriptionRepository,
  ): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object,
          stripeEventCreatedAt,
          subscriptionRepository,
          event.type,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object,
          stripeEventCreatedAt,
          subscriptionRepository,
        );
        break;

      default:
        logger.info({ eventType: event.type }, 'stripe.webhook.unhandled_event');
    }
  }

  private async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription,
    stripeEventCreatedAt: Date,
    subscriptionRepository: SubscriptionRepository,
    eventType: 'customer.subscription.created' | 'customer.subscription.updated',
  ): Promise<void> {
    const providerSubscriptionId = stripeSubscription.id;

    const statusMap: Record<string, string> = {
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      unpaid: 'UNPAID',
      trialing: 'TRIALING',
      paused: 'PAUSED',
      incomplete: 'INCOMPLETE',
      incomplete_expired: 'INCOMPLETE_EXPIRED',
    };

    const mappedStatus =
      statusMap[stripeSubscription.status] ?? stripeSubscription.status.toUpperCase();

    const firstItem = stripeSubscription.items.data[0];
    const periodStart = firstItem ? new Date(firstItem.current_period_start * 1000) : new Date();
    const periodEnd = firstItem ? new Date(firstItem.current_period_end * 1000) : new Date();

    /**
     * sec-B7: resolve the Stripe price id → local plan id. When Stripe is the
     * source of truth (an admin used the Dashboard to swap the plan), the
     * webhook is the only signal we receive — so the sync MUST include
     * `plan_id`. Omit it (rather than setting it to `null`) when the lookup
     * returns no match: a dropped row could mean an unsynced catalog entry,
     * but silently nulling the column would null every cached entitlement and
     * effectively downgrade the customer to "no plan". Better to leave the
     * existing plan_id in place and log the drift — alert tooling already
     * watches webhook-handler logs.
     */
    const stripePriceId = firstItem?.price?.id;
    let resolvedPlanId: number | undefined;
    // Track the matched plan so the sec-B9 fallback INSERT path can derive
    // `billing_cycle` from whether the Stripe price id is the monthly or
    // yearly column on the plan row.
    let matchedPlanForCreate: MatchedPlanForCreate = null;
    if (stripePriceId) {
      const matchedPlan = await this.planRepository.findByStripePriceId(stripePriceId);
      if (matchedPlan) {
        resolvedPlanId = matchedPlan.id;
        matchedPlanForCreate = matchedPlan;
      } else {
        // audit-#13: a Stripe price id with no matching local plan means the
        // plan↔Stripe catalog has drifted (Dashboard price created/changed
        // without syncing `billing.plans`). The row keeps its existing plan_id
        // (never nulled), but the drift must be visible — promote it from a bare
        // log line to a Sentry alert with the offending ids so operators can
        // reconcile the catalog instead of relying on log scraping.
        logger.warn(
          { providerSubscriptionId, stripePriceId },
          'stripe.webhook.plan_id_resolution_miss',
        );
        captureMessage('stripe.webhook.plan_id_resolution_miss', {
          level: 'warning',
          extra: { providerSubscriptionId, stripePriceId },
        });
      }
    }

    const row = await this.subscriptionService.syncFromStripeProviderSubscription(
      providerSubscriptionId,
      omitUndefined({
        status: mappedStatus,
        cancel_at_period_end: stripeSubscription.cancel_at_period_end,
        canceled_at: stripeSubscription.canceled_at
          ? new Date(stripeSubscription.canceled_at * 1000)
          : undefined,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        plan_id: resolvedPlanId,
      }),
      stripeEventCreatedAt,
      subscriptionRepository,
    );

    if (!row) {
      const recovered =
        eventType === 'customer.subscription.created'
          ? await this.tryFallbackInsertForCreated({
              stripeSubscription,
              stripeEventCreatedAt,
              subscriptionRepository,
              resolvedPlanId,
              matchedPlanForCreate,
              stripePriceId,
              periodStart,
              periodEnd,
              mappedStatus,
              providerSubscriptionId,
            })
          : false;
      if (!recovered) {
        // sec-B finding #5: distinguish stale-event from race-condition. The sync UPDATE
        // returns null both when the row does not exist (Stripe outran our HTTP create
        // for `.updated`-before-`.created`) and when the row exists but the watermark
        // already covers a newer event (stale). The prior code conflated the two and
        // silently dropped both, which shadowed newer state when an `.updated` event
        // reordered ahead of `.created`. We now do a separate existence check:
        //   - row exists → stale event, no-op (the newer watermark already wins)
        //   - row missing for a non-`.created` event → throw to retry; BullMQ's
        //     exponential backoff carries the event past the race, and the
        //     `attempts: 5` budget drains genuinely orphan events to the DLQ.
        const rowExists = await this.subscriptionService.existsByStripeProviderSubscriptionId(
          providerSubscriptionId,
          subscriptionRepository,
        );
        if (rowExists) {
          logger.info(
            { providerSubscriptionId, stripeEventCreatedAt, eventType },
            'stripe.webhook.subscription_event_stale_skipped',
          );
        } else {
          logger.warn(
            { providerSubscriptionId, stripeEventCreatedAt, eventType },
            'stripe.webhook.subscription_not_found_will_retry',
          );
          throw new Error(
            `stripe.webhook.subscription_local_row_missing:${eventType}:${providerSubscriptionId}`,
          );
        }
      }
    } else {
      logger.info(
        { providerSubscriptionId, status: mappedStatus },
        'stripe.webhook.subscription_synced',
      );
    }
  }

  /**
   * sec-B9: when `customer.subscription.created` sync returns null (the row
   * did not exist yet — Stripe outran our HTTP create), insert the row
   * straight from the webhook payload. Returns `true` when the recovery
   * insert succeeded (so the caller skips the "stale/not_found" warning),
   * `false` otherwise.
   *
   * Extracted from `handleSubscriptionUpdated` to keep that method below the
   * Biome cognitive-complexity threshold; the policy logic is unchanged. A
   * missing plan id (`subscriptions.plan_id` is NOT NULL) refuses the insert
   * with a structured warning rather than corrupting downstream entitlement
   * reads with a half-broken row.
   */
  private async tryFallbackInsertForCreated(input: {
    stripeSubscription: Stripe.Subscription;
    stripeEventCreatedAt: Date;
    subscriptionRepository: SubscriptionRepository;
    resolvedPlanId: number | undefined;
    matchedPlanForCreate: MatchedPlanForCreate;
    stripePriceId: string | undefined;
    periodStart: Date;
    periodEnd: Date;
    mappedStatus: string;
    providerSubscriptionId: string;
  }): Promise<boolean> {
    const { resolvedPlanId, matchedPlanForCreate, stripePriceId, providerSubscriptionId } = input;
    if (!(resolvedPlanId && matchedPlanForCreate)) {
      logger.warn(
        { providerSubscriptionId, stripePriceId },
        'stripe.webhook.subscription_created_insert_skipped_no_plan',
      );
      return false;
    }
    const billingCycle = resolveBillingCycleForStripePrice(stripePriceId, matchedPlanForCreate);
    const inserted = await this.subscriptionService.createFromStripeWebhookEvent({
      providerSubscriptionId,
      providerCustomerId:
        typeof input.stripeSubscription.customer === 'string'
          ? input.stripeSubscription.customer
          : null,
      planId: resolvedPlanId,
      status: input.mappedStatus,
      cancelAtPeriodEnd: input.stripeSubscription.cancel_at_period_end,
      canceledAt: input.stripeSubscription.canceled_at
        ? new Date(input.stripeSubscription.canceled_at * 1000)
        : null,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      billingCycle,
      stripeEventCreatedAt: input.stripeEventCreatedAt,
      repositoryOverride: input.subscriptionRepository,
    });
    if (!inserted) return false;
    logger.info(
      { providerSubscriptionId, planId: resolvedPlanId, billingCycle },
      'stripe.webhook.subscription_inserted_on_created',
    );
    return true;
  }

  private async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription,
    stripeEventCreatedAt: Date,
    subscriptionRepository: SubscriptionRepository,
  ): Promise<void> {
    const providerSubscriptionId = stripeSubscription.id;

    const row = await this.subscriptionService.markCanceledByStripeProviderSubscriptionId(
      providerSubscriptionId,
      stripeEventCreatedAt,
      subscriptionRepository,
    );

    if (!row) {
      logger.warn(
        { providerSubscriptionId, stripeEventCreatedAt },
        'stripe.webhook.subscription_cancel_stale_or_missing',
      );
    } else {
      logger.info({ providerSubscriptionId }, 'stripe.webhook.subscription_canceled');
    }
  }
}
