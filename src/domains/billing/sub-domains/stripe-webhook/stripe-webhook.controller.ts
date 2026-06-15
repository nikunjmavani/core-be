import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '@/shared/errors/index.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { serializeStripeWebhookAcknowledgement } from './stripe-webhook.serializer.js';
import type { StripeWebhookService } from './stripe-webhook.service.js';

/**
 * Builds the Stripe webhook ingress handler. Signature verification has already
 * run in `stripeWebhookIngressPlugin` and exposed the parsed event on
 * `request.stripeWebhookEvent`; this thin handler coordinates the request only:
 * it delegates the durability commit + BullMQ enqueue to
 * {@link StripeWebhookService.ingestEvent} and then ACKs Stripe with 200.
 */
export function createStripeWebhookController(stripeWebhookService: StripeWebhookService) {
  return {
    /**
     * POST /api/v1/billing/webhook (and the deprecated /stripe/webhook alias).
     * Signature verification runs in stripeWebhookIngressPlugin before this handler;
     * because the raw body is validated by the signature, no Zod request validator applies.
     */
    async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
      const event = request.stripeWebhookEvent;
      if (!event) {
        throw new ValidationError('errors:stripeWebhookVerificationFailed');
      }

      // sec-B finding #6: the service performs the durability commit to Postgres BEFORE this
      // handler returns 200, so a Redis hiccup between ingress and worker pickup cannot drop the
      // event. The reclaim cron sweeps stuck ledger rows back into BullMQ if the enqueue is lost.
      await stripeWebhookService.ingestEvent(event, {
        requestId: getRequestIdentifier(request),
      });

      reply.status(200);
      return successResponse(
        serializeStripeWebhookAcknowledgement(),
        getRequestIdentifier(request),
      );
    },
  };
}
