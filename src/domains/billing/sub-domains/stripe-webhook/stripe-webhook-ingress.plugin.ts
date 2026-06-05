import type { FastifyPluginAsync } from 'fastify';
import {
  constructStripeWebhookEvent,
  isStripeWebhookIngressConfigured,
} from '@/infrastructure/payment/stripe.client.js';
import { ServiceUnavailableError, ValidationError } from '@/shared/errors/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Enforces Stripe webhook HMAC verification on every route registered after this plugin.
 * Controllers must read {@link FastifyRequest.stripeWebhookEvent} — not parse the body themselves.
 */
export const stripeWebhookIngressPlugin: FastifyPluginAsync = async (application) => {
  application.addHook('preHandler', async (request) => {
    if (!isStripeWebhookIngressConfigured()) {
      throw new ServiceUnavailableError('errors:stripeNotConfigured');
    }

    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new ValidationError('errors:missingStripeSignature');
    }

    let parsedBody: Buffer | undefined;
    if (Buffer.isBuffer(request.body)) {
      parsedBody = request.body;
    } else if (typeof request.body === 'string') {
      parsedBody = Buffer.from(request.body);
    } else if (request.body === undefined) {
      parsedBody = undefined;
    } else {
      parsedBody = Buffer.from(JSON.stringify(request.body));
    }
    const rawBody = request.rawBody ?? parsedBody;
    if (!rawBody) {
      throw new ValidationError('errors:missingRawBody');
    }

    try {
      const stripeWebhookEvent = constructStripeWebhookEvent(rawBody, signature);
      request.stripeWebhookEvent = stripeWebhookEvent;
      logger.info(
        { eventId: stripeWebhookEvent.id, eventType: stripeWebhookEvent.type },
        'stripe.webhook.verified',
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'stripe.webhook.verification_failed',
      );
      throw new ValidationError('errors:stripeWebhookVerificationFailed');
    }
  });
};
