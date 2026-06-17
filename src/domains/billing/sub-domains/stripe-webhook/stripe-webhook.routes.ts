import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WEBHOOK_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { createStripeWebhookController } from './stripe-webhook.controller.js';
import type { StripeWebhookService } from './stripe-webhook.service.js';
import { stripeWebhookIngressPlugin } from './stripe-webhook-ingress.plugin.js';
import { registerStripeWebhookRawBodyRoute } from './stripe-webhook-raw-body.registry.js';

/**
 * Registers the Stripe webhook receiver at the canonical path:
 *
 *   POST /api/v1/billing/webhook  — Stripe Dashboard endpoints and the Stripe CLI
 *                                   (`stripe listen --forward-to`) must be configured
 *                                   against this URL. The raw JSON body is required for
 *                                   `Stripe-Signature` verification.
 */
export function stripeWebhookRoutes(
  stripeWebhookService: StripeWebhookService,
): FastifyPluginAsync {
  const controller = createStripeWebhookController(stripeWebhookService);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();

    // sec-B finding #7: register every Stripe webhook URL with the raw-body registry
    // at route-declaration time. The content-type parser reads from this registry on
    // every request, so a rename / restructure of the webhook URL flows through
    // automatically and a wiring drift would fail closed at the first request rather
    // than silently for the 3-day Stripe retry window.
    app.addHook('onRoute', (routeOptions) => {
      if (
        routeOptions.config &&
        (routeOptions.config as Record<string, unknown>).captureRawBody === true
      ) {
        registerStripeWebhookRawBodyRoute(routeOptions.url);
      }
    });

    await stripeWebhookIngressPlugin(app, {});
    zodApplication.post(
      '/webhook',
      {
        ...WEBHOOK_RATE_LIMIT,
        config: { captureRawBody: true },
        // sec-C/M #29: lift the per-route body limit to 5 MB. The global default is
        // 1 MB, but line-item-heavy `invoice.finalized` events legitimately exceed
        // that in production. A 413 here turns into "Stripe retries for 3 days then
        // parks the event," which silently desyncs local entitlement / dunning state.
        // 5 MB matches Stripe's recommended upper bound for webhook payloads.
        bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT_BYTES,
        schema: {
          summary: 'Stripe webhook receiver',
          description:
            'Public endpoint for Stripe billing events. Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` and enqueues durable processing. Raw JSON body is required for signature verification.',
          tags: ['Billing', 'Stripe Webhook'],
        },
      },
      controller.handleWebhook,
    );
  };
}

/** sec-C/M #29: per-route body limit for Stripe webhook receivers (5 MB). */
const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
