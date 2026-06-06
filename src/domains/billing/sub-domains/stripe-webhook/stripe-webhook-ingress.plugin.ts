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

    // sec-B finding #7: the prior `Buffer.from(JSON.stringify(request.body))` fallback
    // was dead code at best (re-stringified JSON CANNOT produce a byte-identical body
    // for HMAC verification — key order, whitespace, escape sequences all diverge),
    // and at worst masked the real bug: the route's `bodyLimit` / content-type-parser
    // wiring failed to populate `request.rawBody`. With the fallback removed, a wiring
    // bug fails closed AT THE FIRST REQUEST instead of silently rejecting every
    // production webhook for the 3-day Stripe retry window.
    //
    // The Buffer-typed body branch is retained because Fastify's
    // `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` populates
    // `request.body` with the raw Buffer for routes flagged via `routeOptions.config`
    // (see `stripe-webhook.routes.ts`). The string branch handles a downstream parser
    // that decodes the buffer to a string before reaching the preHandler.
    let parsedBody: Buffer | undefined;
    if (Buffer.isBuffer(request.body)) {
      parsedBody = request.body;
    } else if (typeof request.body === 'string') {
      parsedBody = Buffer.from(request.body);
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
