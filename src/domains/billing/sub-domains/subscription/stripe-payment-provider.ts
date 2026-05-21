import type { OrganizationBillingContext } from '@/domains/tenancy/sub-domains/organization/organization.types.js';
import type { PlanRecord } from '@/domains/billing/sub-domains/plan/plan.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { PaymentProvider, PaymentProviderCreateResult } from './payment-provider.port.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  isStripeConfigured,
  createStripeCustomer,
  createStripeSubscription,
  cancelStripeSubscription,
  resumeStripeSubscription,
  updateStripeSubscription,
} from '@/infrastructure/payment/stripe.client.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Stripe implementation of {@link PaymentProvider}.
 */
export class StripePaymentProvider implements PaymentProvider {
  constructor(private readonly organizationService: OrganizationService) {}

  isConfigured(): boolean {
    return isStripeConfigured();
  }

  getProviderPriceId(plan: PlanRecord, billingCycle: 'monthly' | 'yearly'): string | null {
    const priceId =
      billingCycle === 'yearly' ? plan.stripe_price_yearly_id : plan.stripe_price_monthly_id;
    return priceId ?? null;
  }

  async createSubscription(input: {
    organization: OrganizationBillingContext;
    plan: PlanRecord;
    billingCycle: 'monthly' | 'yearly';
    trialEnd?: string;
    idempotencyKey?: string;
  }): Promise<PaymentProviderCreateResult> {
    if (!isStripeConfigured()) return {};

    try {
      let stripeCustomerId = input.organization.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await createStripeCustomer({
          email: `billing@${input.organization.slug}.com`,
          name: input.organization.name,
          metadata: { organization_id: input.organization.public_id },
        });
        stripeCustomerId = customer.id;
        await this.organizationService.updateStripeCustomerIdForOrganization(
          input.organization.public_id,
          stripeCustomerId,
        );
      }

      const stripePriceId = this.getProviderPriceId(input.plan, input.billingCycle);

      if (!stripePriceId) {
        logger.warn(
          { planId: input.plan.public_id, billingCycle: input.billingCycle },
          'Plan missing Stripe price ID — creating local-only subscription',
        );
        return { providerCustomerId: stripeCustomerId };
      }

      const stripeSubscription = await createStripeSubscription(
        omitUndefined({
          customerId: stripeCustomerId,
          priceId: stripePriceId,
          trialEnd: input.trialEnd
            ? Math.floor(new Date(input.trialEnd).getTime() / 1000)
            : undefined,
          metadata: { organization_id: input.organization.public_id },
          idempotencyKey: input.idempotencyKey,
        }),
      );

      return {
        providerSubscriptionId: stripeSubscription.id,
        providerCustomerId: stripeCustomerId,
      };
    } catch (error) {
      logger.error({ error }, 'stripe.subscription.create.failed');
      return {};
    }
  }

  async cancelSubscriptionAtPeriodEnd(providerSubscriptionId: string): Promise<void> {
    if (!isStripeConfigured()) return;
    try {
      await cancelStripeSubscription(providerSubscriptionId, true);
    } catch (error) {
      logger.error({ error }, 'stripe.subscription.cancel.failed');
    }
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    if (!isStripeConfigured()) return;
    try {
      await resumeStripeSubscription(providerSubscriptionId);
    } catch (error) {
      logger.error({ error }, 'stripe.subscription.resume.failed');
    }
  }

  async updateSubscriptionPrice(
    providerSubscriptionId: string,
    providerPriceId: string,
  ): Promise<boolean> {
    if (!isStripeConfigured()) return false;
    try {
      await updateStripeSubscription(providerSubscriptionId, { priceId: providerPriceId });
      return true;
    } catch (error) {
      logger.error({ error }, 'stripe.subscription.change_plan.failed');
      return false;
    }
  }

  async compensateFailedCreate(providerSubscriptionId: string): Promise<void> {
    try {
      await cancelStripeSubscription(providerSubscriptionId, false);
    } catch (compensationError) {
      logger.error(
        { error: compensationError, providerSubscriptionId },
        'stripe.subscription.create.compensation_failed',
      );
    }
  }

  async compensatePlanChange(
    providerSubscriptionId: string,
    previousProviderPriceId: string,
  ): Promise<void> {
    try {
      await updateStripeSubscription(providerSubscriptionId, {
        priceId: previousProviderPriceId,
      });
    } catch (compensationError) {
      logger.error(
        { error: compensationError, providerSubscriptionId },
        'stripe.subscription.change_plan.compensation_failed',
      );
    }
  }
}
