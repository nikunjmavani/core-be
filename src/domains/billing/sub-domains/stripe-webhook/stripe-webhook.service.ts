import type Stripe from 'stripe';
import type { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import { createWorkerSubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { ConflictError } from '@/shared/errors/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { StripeWebhookEventRepository } from './stripe-webhook-event.repository.js';
import { runStripeWebhookHandlerWithOrganizationContext } from './stripe-webhook-organization.util.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';

/**
 * Processes Stripe webhook events and syncs subscription state.
 * Plans are managed offline via admin panel — subscription lifecycle events only.
 */
export class StripeWebhookService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly stripeWebhookEventRepository: StripeWebhookEventRepository,
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
        await runStripeWebhookHandlerWithOrganizationContext(event, async (databaseHandle) => {
          const workerSubscriptionRepository = createWorkerSubscriptionRepository(databaseHandle);
          await this.dispatchEvent(event, stripeEventCreatedAt, workerSubscriptionRepository);
        });
        await this.stripeWebhookEventRepository.markProcessed(event.id);
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        await this.stripeWebhookEventRepository.markFailed(event.id, failureReason);
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
          event.data.object as Stripe.Subscription,
          stripeEventCreatedAt,
          subscriptionRepository,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
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

    const rawSubscription = stripeSubscription as unknown as Record<string, unknown>;
    const periodStart =
      typeof rawSubscription.current_period_start === 'number'
        ? new Date((rawSubscription.current_period_start as number) * 1000)
        : new Date();
    const periodEnd =
      typeof rawSubscription.current_period_end === 'number'
        ? new Date((rawSubscription.current_period_end as number) * 1000)
        : new Date();

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
      }),
      stripeEventCreatedAt,
      subscriptionRepository,
    );

    if (!row) {
      logger.warn(
        { providerSubscriptionId, stripeEventCreatedAt },
        'stripe.webhook.subscription_not_found_or_stale',
      );
    } else {
      logger.info(
        { providerSubscriptionId, status: mappedStatus },
        'stripe.webhook.subscription_synced',
      );
    }
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
