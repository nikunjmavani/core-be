import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '@/shared/errors/index.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { enqueueStripeWebhook } from './queues/stripe-webhook.queue.js';
import { serializeStripeWebhookAcknowledgement } from './stripe-webhook.serializer.js';
import { StripeWebhookEventRepository } from './stripe-webhook-event.repository.js';

/**
 * Builds the Stripe webhook ingress handler. Signature verification has already
 * run in `stripeWebhookIngressPlugin` and exposed the parsed event on
 * `request.stripeWebhookEvent`; this handler now:
 *
 *   1. Persists the event to the Postgres ledger via `tryClaimEvent` — this is
 *      the **durability commit** (sec-B finding #6). The HTTP path returns 200
 *      to Stripe only AFTER the row lands in Postgres, so a Redis loss between
 *      ingress and worker pickup cannot drop the event silently. The reclaim
 *      cron sweeps rows that get stuck and re-enqueues them.
 *   2. Enqueues the event to BullMQ for asynchronous worker processing — but
 *      only when the ledger transition was `claimed` or `reclaimed`. A
 *      `processed_duplicate` skips the enqueue (it would be a no-op). A
 *      `still_processing_within_lease` likewise skips (an in-flight worker
 *      will finish).
 */
export function createStripeWebhookController() {
  const stripeWebhookEventRepository = new StripeWebhookEventRepository();

  return {
    /**
     * POST /api/v1/billing/stripe/webhook
     * Signature verification runs in stripeWebhookIngressPlugin before this handler;
     * because the raw body is validated by the signature, no Zod request validator applies.
     */
    async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
      const event = request.stripeWebhookEvent;
      if (!event) {
        throw new ValidationError('errors:stripeWebhookVerificationFailed');
      }

      // sec-B finding #6: durability commits to Postgres BEFORE the 200 ACK so a
      // Redis hiccup between ingress and worker pickup cannot drop the event. The
      // ledger row is also the source of truth for the reclaim cron, which sweeps
      // stuck rows back into BullMQ if the initial enqueue is lost.
      const claimResult = await withSystemTableWorkerContext(() =>
        stripeWebhookEventRepository.tryClaimEvent({
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_created_at: new Date(event.created * 1000),
          request_id: getRequestIdentifier(request),
        }),
      );

      if (claimResult === 'claimed' || claimResult === 'reclaimed') {
        await enqueueStripeWebhook(event, getRequestIdentifier(request));
      } else {
        // `processed_duplicate` or `still_processing_within_lease` — the event is
        // already in a terminal or in-flight state. Acknowledge to Stripe so it
        // does not retry, and rely on the existing handler / reclaim cron to
        // complete or recover.
        logger.info(
          { stripeEventId: event.id, eventType: event.type, claimResult },
          'stripe.webhook.ingress.skip_enqueue',
        );
      }

      reply.status(200);
      return successResponse(
        serializeStripeWebhookAcknowledgement(),
        getRequestIdentifier(request),
      );
    },
  };
}
