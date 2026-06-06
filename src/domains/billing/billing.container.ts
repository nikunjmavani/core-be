import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import { PlanRepository } from './sub-domains/plan/plan.repository.js';
import { SubscriptionRepository } from './sub-domains/subscription/subscription.repository.js';
import { PlanService } from './sub-domains/plan/plan.service.js';
import { StripePaymentProvider } from './sub-domains/subscription/stripe-payment-provider.js';
import { SubscriptionService } from './sub-domains/subscription/subscription.service.js';
import { StripeWebhookService } from './sub-domains/stripe-webhook/stripe-webhook.service.js';
import { StripeWebhookEventRepository } from './sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

/**
 * Services exposed by the billing domain composition root for routes and the
 * Fastify decoration `app.billingDomain`.
 */
export type BillingContainer = {
  planService: PlanService;
  subscriptionService: SubscriptionService;
  stripeWebhookService: StripeWebhookService;
};

/**
 * Wires plan / subscription / stripe-webhook repositories and services together,
 * injecting the tenancy {@link OrganizationService} required for cross-domain
 * organization lookups during checkout and webhook processing.
 */
export function createBillingContainer(organizationService: OrganizationService): BillingContainer {
  const planRepository = new PlanRepository();
  const subscriptionRepository = new SubscriptionRepository();

  const planService = new PlanService(planRepository);
  const paymentProvider = new StripePaymentProvider(organizationService);
  const subscriptionService = new SubscriptionService(
    organizationService,
    planService,
    subscriptionRepository,
    paymentProvider,
  );
  const stripeWebhookEventRepository = new StripeWebhookEventRepository();
  const stripeWebhookService = new StripeWebhookService(
    subscriptionService,
    stripeWebhookEventRepository,
    planRepository,
  );

  return {
    planService,
    subscriptionService,
    stripeWebhookService,
  };
}

/**
 * Decorates the Fastify instance with `billingDomain` so route plugins can
 * resolve billing services without rebuilding the container per request.
 */
export function registerBillingContainer(application: FastifyInstance): void {
  application.decorate(
    'billingDomain',
    createBillingContainer(application.tenancyDomain.organizationService),
  );
}
