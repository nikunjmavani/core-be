import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import { PlanRepository } from './sub-domains/plan/plan.repository.js';
import { SubscriptionRepository } from './sub-domains/subscription/subscription.repository.js';
import { PlanService } from './sub-domains/plan/plan.service.js';
import { StripePaymentProvider } from './sub-domains/subscription/stripe-payment-provider.js';
import { SubscriptionService } from './sub-domains/subscription/subscription.service.js';
import { StripeWebhookService } from './sub-domains/stripe-webhook/stripe-webhook.service.js';
import { StripeWebhookEventRepository } from './sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

export type BillingContainer = {
  planService: PlanService;
  subscriptionService: SubscriptionService;
  stripeWebhookService: StripeWebhookService;
};

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
  );

  return {
    planService,
    subscriptionService,
    stripeWebhookService,
  };
}

export function registerBillingContainer(application: FastifyInstance): void {
  application.decorate(
    'billingDomain',
    createBillingContainer(application.tenancyDomain.organizationService),
  );
}
