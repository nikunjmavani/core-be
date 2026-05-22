import { NotFoundError } from '@/shared/errors/index.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import type { PaymentProvider } from './payment-provider.port.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import type { SubscriptionUpdateData } from './subscription.types.js';
import {
  validateChangePlan,
  validateCreateSubscription,
  validateUpdateSubscription,
} from './subscription.validator.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/**
 * Coordinates plan lookups, payment-provider calls, and subscription updates
 * for a single organization.
 */
export class SubscriptionService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly planService: PlanService,
    private readonly repository: SubscriptionRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async syncFromStripeProviderSubscription(
    provider_subscription_id: string,
    data: SubscriptionUpdateData,
    stripe_event_created_at: Date,
    repositoryOverride?: SubscriptionRepository,
  ) {
    const repository = repositoryOverride ?? this.repository;
    return repository.syncFromStripeProviderSubscription(
      provider_subscription_id,
      data,
      stripe_event_created_at,
    );
  }

  async markCanceledByStripeProviderSubscriptionId(
    provider_subscription_id: string,
    stripe_event_created_at: Date,
    repositoryOverride?: SubscriptionRepository,
  ) {
    const repository = repositoryOverride ?? this.repository;
    return repository.markCanceledByProviderSubscriptionId(
      provider_subscription_id,
      stripe_event_created_at,
    );
  }

  async list(organization_public_id: string) {
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);
    return this.repository.listByOrganization(organization.id);
  }

  async get(organization_public_id: string, subscription_public_id: string) {
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);
    const subscription = await this.repository.findByPublicId(
      subscription_public_id,
      organization.id,
    );
    if (!subscription) throw new NotFoundError('Subscription');
    return subscription;
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
    idempotencyKey?: string,
  ) {
    const parsed = validateCreateSubscription(body);
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);
    const plan = await this.planService.requirePlanRecordByPublicId(parsed.plan_id);
    const createdByUserInternalId =
      await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (parsed.billing_cycle === 'yearly' ? 12 : 1));

    const paymentResult = await this.paymentProvider.createSubscription(
      omitUndefined({
        organization,
        plan,
        billingCycle: parsed.billing_cycle,
        trialEnd: parsed.trial_end,
        idempotencyKey,
      }),
    );

    try {
      return await this.repository.create(
        omitUndefined({
          organization_id: organization.id,
          plan_id: plan.id,
          billing_cycle: parsed.billing_cycle.toUpperCase() as 'MONTHLY' | 'YEARLY',
          current_period_start: now,
          current_period_end: periodEnd,
          trial_end: parsed.trial_end ? new Date(parsed.trial_end) : undefined,
          created_by_user_id: createdByUserInternalId ?? undefined,
          provider: paymentResult.providerSubscriptionId ? 'stripe' : undefined,
          provider_subscription_id: paymentResult.providerSubscriptionId,
          provider_customer_id: paymentResult.providerCustomerId,
        }),
      );
    } catch (error) {
      if (paymentResult.providerSubscriptionId) {
        await this.paymentProvider.compensateFailedCreate(paymentResult.providerSubscriptionId);
      }
      throw error;
    }
  }

  async update(organization_public_id: string, subscription_public_id: string, body: unknown) {
    const parsed = validateUpdateSubscription(body);
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);
    const updated = await this.repository.update(
      subscription_public_id,
      organization.id,
      omitUndefined({ cancel_at_period_end: parsed.cancel_at_period_end }),
    );
    if (!updated) throw new NotFoundError('Subscription');
    return updated;
  }

  async changePlan(organization_public_id: string, subscription_public_id: string, body: unknown) {
    const parsed = validateChangePlan(body);
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);
    const plan = await this.planService.requirePlanRecordByPublicId(parsed.plan_id);
    const subscription = await this.repository.findByPublicId(
      subscription_public_id,
      organization.id,
    );
    if (!subscription) throw new NotFoundError('Subscription');

    const previousPlan = await this.planService.requirePlanRecordByInternalId(subscription.plan_id);
    const providerPriceId = this.paymentProvider.getProviderPriceId(
      plan,
      subscription.billing_cycle === 'YEARLY' ? 'yearly' : 'monthly',
    );
    let providerPlanUpdated = false;

    if (subscription.provider_subscription_id && providerPriceId) {
      providerPlanUpdated = await this.paymentProvider.updateSubscriptionPrice(
        subscription.provider_subscription_id,
        providerPriceId,
      );
    }

    const periodStart = new Date(subscription.current_period_start);
    const periodEnd = new Date(subscription.current_period_end);
    try {
      const updated = await this.repository.update(subscription_public_id, organization.id, {
        plan_id: plan.id,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      });
      if (!updated) throw new NotFoundError('Subscription');
      return updated;
    } catch (error) {
      if (providerPlanUpdated && subscription.provider_subscription_id) {
        const previousProviderPriceId = this.paymentProvider.getProviderPriceId(
          previousPlan,
          subscription.billing_cycle === 'YEARLY' ? 'yearly' : 'monthly',
        );
        if (previousProviderPriceId) {
          await this.paymentProvider.compensatePlanChange(
            subscription.provider_subscription_id,
            previousProviderPriceId,
          );
        }
      }
      throw error;
    }
  }

  async cancel(organization_public_id: string, subscription_public_id: string) {
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);

    const subscription = await this.repository.findByPublicId(
      subscription_public_id,
      organization.id,
    );
    if (!subscription) throw new NotFoundError('Subscription');

    if (subscription.provider_subscription_id) {
      await this.paymentProvider.cancelSubscriptionAtPeriodEnd(
        subscription.provider_subscription_id,
      );
    }

    const updated = await this.repository.update(subscription_public_id, organization.id, {
      cancel_at_period_end: true,
    });
    if (!updated) throw new NotFoundError('Subscription');
    return updated;
  }

  async resume(organization_public_id: string, subscription_public_id: string) {
    const organization =
      await this.organizationService.requireOrganizationByPublicId(organization_public_id);

    const subscription = await this.repository.findByPublicId(
      subscription_public_id,
      organization.id,
    );
    if (!subscription) throw new NotFoundError('Subscription');

    if (subscription.provider_subscription_id) {
      await this.paymentProvider.resumeSubscription(subscription.provider_subscription_id);
    }

    const updated = await this.repository.update(subscription_public_id, organization.id, {
      cancel_at_period_end: false,
      status: 'ACTIVE',
    });
    if (!updated) throw new NotFoundError('Subscription');
    return updated;
  }
}
