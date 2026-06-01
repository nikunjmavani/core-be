import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '@/shared/errors/index.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { enqueueStripeWebhook } from './queues/stripe-webhook.queue.js';
import { serializeStripeWebhookAcknowledgement } from './stripe-webhook.serializer.js';

/**
 * Builds the Stripe webhook ingress handler. Signature verification has already
 * run in `stripeWebhookIngressPlugin` and exposed the parsed event on
 * `request.stripeWebhookEvent`; this handler only enqueues the event for the
 * BullMQ worker and returns a `200 { received: true }` acknowledgement.
 */
export function createStripeWebhookController() {
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

      await enqueueStripeWebhook(event, getRequestIdentifier(request));

      reply.status(200);
      return successResponse(
        serializeStripeWebhookAcknowledgement(),
        getRequestIdentifier(request),
      );
    },
  };
}
