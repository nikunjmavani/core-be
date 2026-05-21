import type { OrganizationBillingContext } from '@/domains/tenancy/sub-domains/organization/organization.types.js';
import type { PlanRecord } from '@/domains/billing/sub-domains/plan/plan.service.js';

export type PaymentProviderCreateResult = {
  providerSubscriptionId?: string;
  providerCustomerId?: string;
};

/**
 * Port for external payment provider subscription lifecycle (Stripe today; others later).
 */
export interface PaymentProvider {
  isConfigured(): boolean;

  getProviderPriceId(plan: PlanRecord, billingCycle: 'monthly' | 'yearly'): string | null;

  createSubscription(input: {
    organization: OrganizationBillingContext;
    plan: PlanRecord;
    billingCycle: 'monthly' | 'yearly';
    trialEnd?: string;
    idempotencyKey?: string;
  }): Promise<PaymentProviderCreateResult>;

  cancelSubscriptionAtPeriodEnd(providerSubscriptionId: string): Promise<void>;

  resumeSubscription(providerSubscriptionId: string): Promise<void>;

  updateSubscriptionPrice(
    providerSubscriptionId: string,
    providerPriceId: string,
  ): Promise<boolean>;

  compensateFailedCreate(providerSubscriptionId: string): Promise<void>;

  compensatePlanChange(
    providerSubscriptionId: string,
    previousProviderPriceId: string,
  ): Promise<void>;
}
