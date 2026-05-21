import type { FastifyPluginAsync } from 'fastify';
import { planRoutes } from './sub-domains/plan/plan.routes.js';
import { subscriptionRoutes } from './sub-domains/subscription/subscription.routes.js';
import { stripeWebhookRoutes } from './sub-domains/stripe-webhook/stripe-webhook.routes.js';

export const billingRoutesPlugin: FastifyPluginAsync = async (app) => {
  const { billingDomain } = app;
  await app.register(stripeWebhookRoutes());
  await app.register(planRoutes(billingDomain.planService));
  await app.register(subscriptionRoutes(billingDomain.subscriptionService));
};
