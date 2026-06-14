import type { FastifyPluginAsync } from 'fastify';
import { planRoutes } from './sub-domains/plan/plan.routes.js';
import { subscriptionRoutes } from './sub-domains/subscription/subscription.routes.js';
import { stripeWebhookRoutes } from './sub-domains/stripe-webhook/stripe-webhook.routes.js';

/**
 * Fastify plugin that mounts billing sub-domain routes (Stripe webhook ingress,
 * plan catalog, organization subscriptions) using services from `app.billingDomain`.
 */
export const billingRoutesPlugin: FastifyPluginAsync = async (app) => {
  const { billingDomain } = app;
  await app.register(stripeWebhookRoutes(billingDomain.stripeWebhookService));
  await app.register(planRoutes(billingDomain.planService));
  await app.register(subscriptionRoutes(billingDomain.subscriptionService));
};
