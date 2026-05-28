import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WEBHOOK_RATE_LIMIT } from '@/shared/middlewares/rate-limit-presets.constants.js';
import { createStripeWebhookController } from './stripe-webhook.controller.js';
import { stripeWebhookIngressPlugin } from './stripe-webhook-ingress.plugin.js';

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
    await stripeWebhookIngressPlugin(app, {});
    zodApplication.post(
      '/webhook',
      {
        ...WEBHOOK_RATE_LIMIT,
        schema: {
          summary: 'Stripe webhook receiver',
          description:
            'Public endpoint for Stripe billing events. Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` and enqueues durable processing. Raw JSON body is required for signature verification.',
          tags: ['Billing', 'Stripe Webhook'],
        },
      },
      controller.handleWebhook,
    );

    await app.register(
      async (stripeRoutes) => {
        const stripeZodApplication = stripeRoutes.withTypeProvider<ZodTypeProvider>();
        await stripeRoutes.register(stripeWebhookIngressPlugin);
        stripeZodApplication.post(
          '/webhook',
          {
            ...WEBHOOK_RATE_LIMIT,
            schema: {
              summary: 'Stripe webhook receiver',
              description:
                'Public endpoint for Stripe billing events. Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` and enqueues durable processing. Raw JSON body is required for signature verification.',
              tags: ['Billing', 'Stripe Webhook'],
            },
          },
          controller.handleWebhook,
        );
      },
      { prefix: '/stripe' },
    );
  };
}
