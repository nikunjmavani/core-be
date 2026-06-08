import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WEBHOOK_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { applyDeprecatedEndpointHeaders } from '@/shared/utils/http/api-versioning.util.js';
import { createStripeWebhookController } from './stripe-webhook.controller.js';
import { stripeWebhookIngressPlugin } from './stripe-webhook-ingress.plugin.js';
import { registerStripeWebhookRawBodyRoute } from './stripe-webhook-raw-body.registry.js';

/**
 * Stripe webhook receiver is registered at two paths that share the same handler:
 *
 *   POST /api/v1/billing/webhook         — Canonical receiver. New Stripe Dashboard
 *                                          endpoints (and Stripe CLI `stripe listen
 *                                          --forward-to`) must be configured against
 *                                          this URL.
 *
 *   POST /api/v1/billing/stripe/webhook  — DEPRECATED backwards-compatibility alias.
 *                                          Retained only for existing Stripe Dashboard
 *                                          endpoints that were configured against the
 *                                          legacy `/stripe/webhook` path before the
 *                                          route was moved to the bare `/webhook`.
 *
 * No fixed sunset date is set yet. Do NOT delete the `/stripe/webhook` registration
 * until every live Stripe webhook endpoint (Dashboard + Stripe CLI forwarders, in
 * every environment) has been migrated to the canonical `/api/v1/billing/webhook`
 * URL — otherwise events from un-migrated Stripe configurations will drop with 404
 * and the asynchronous worker will never see them.
 *
 * When the alias is removed, also clean up the legacy path in downstream references
 * that still point at it: the controller JSDoc, `stripe-webhook.dto.ts` comment,
 * the duplicate route schema literal below (alias `app.register({ prefix: '/stripe' })`),
 * integration tests, k6 load scenarios, and Sentry transaction-name sampling.
 */
export function stripeWebhookRoutes(): FastifyPluginAsync {
  const controller = createStripeWebhookController();

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

    // sec-new-M2: emit RFC 8594 Sunset + RFC 9745 Deprecation response headers on
    // EVERY response from the deprecated alias, including pre-handler error paths.
    // `onSend` is used (instead of a wrapper handler) because `stripeWebhookIngressPlugin`
    // registers a `preHandler` that throws before the route handler runs on invalid
    // signatures — if headers were set in the handler they would be silently dropped.
    // The `onSend` lifecycle hook fires on both success and error paths.
    zodApplication.post(
      '/stripe/webhook',
      {
        ...WEBHOOK_RATE_LIMIT,
        config: { captureRawBody: true },
        bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT_BYTES,
        onSend: [
          async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
            applyDeprecatedEndpointHeaders(reply, {
              sunset: STRIPE_WEBHOOK_ALIAS_SUNSET,
              deprecation: true,
            });
            return payload;
          },
        ],
        schema: {
          summary: 'Stripe webhook receiver (DEPRECATED alias)',
          description:
            'DEPRECATED. Use POST /api/v1/billing/webhook instead. This backwards-compatibility alias will be removed once all Stripe Dashboard and CLI forwarder endpoints have been migrated to the canonical path.',
          tags: ['Billing', 'Stripe Webhook'],
        },
      },
      controller.handleWebhook,
    );
  };
}

/** sec-C/M #29: per-route body limit for Stripe webhook receivers (5 MB). */
const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * Placeholder Sunset date for the deprecated `/api/v1/billing/stripe/webhook` alias
 * (sec-new-M2). No firm removal date is set yet. Update this constant — and notify
 * all Stripe Dashboard / CLI forwarder operators — once a real sunset is agreed.
 */
const STRIPE_WEBHOOK_ALIAS_SUNSET = new Date('2030-01-01T00:00:00Z');
