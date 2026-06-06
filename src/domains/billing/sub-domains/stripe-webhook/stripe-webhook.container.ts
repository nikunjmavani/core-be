import { PlanRepository } from '@/domains/billing/sub-domains/plan/plan.repository.js';
import { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import { StripePaymentProvider } from '@/domains/billing/sub-domains/subscription/stripe-payment-provider.js';
import { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { StripeWebhookEventRepository } from './stripe-webhook-event.repository.js';
import { StripeWebhookService } from './stripe-webhook.service.js';

/**
 * Worker-safe DI for Stripe webhook processing (no Fastify application).
 */
export function createStripeWebhookServiceForWorker(): StripeWebhookService {
  const organizationRepository = new OrganizationRepository();
  const organizationService = new OrganizationService(
    organizationRepository,
    getDefaultS3ObjectStorageAdapter(),
  );
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

  return new StripeWebhookService(
    subscriptionService,
    stripeWebhookEventRepository,
    planRepository,
  );
}
