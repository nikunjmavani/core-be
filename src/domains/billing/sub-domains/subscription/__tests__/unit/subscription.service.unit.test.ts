import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { NotFoundError } from '@/shared/errors/index.js';
import { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import { StripePaymentProvider } from '@/domains/billing/sub-domains/subscription/stripe-payment-provider.js';
import type { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';

const stripeMocks = vi.hoisted(() => ({
  isStripeConfigured: vi.fn(() => false),
  createStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_stripe' }),
  createStripeSubscription: vi.fn().mockResolvedValue({ id: 'sub_stripe' }),
  updateStripeSubscription: vi.fn().mockResolvedValue({ id: 'sub_stripe' }),
  cancelStripeSubscription: vi.fn().mockResolvedValue({ id: 'sub_stripe' }),
  resumeStripeSubscription: vi.fn().mockResolvedValue({ id: 'sub_stripe' }),
}));

vi.mock('@/infrastructure/payment/stripe.client.js', () => stripeMocks);

const organization = {
  id: 1,
  public_id: 'org_public',
  stripe_customer_id: null,
  name: 'Org',
  slug: 'org',
};
const plan = {
  id: 2,
  public_id: 'plan_public',
  price_monthly: '10.00',
  price_yearly: '100.00',
  currency: 'USD',
  stripe_price_monthly_id: null,
  stripe_price_yearly_id: null,
};
const subscriptionRow = {
  id: 3,
  public_id: 'sub_public',
  organization_id: 1,
  plan_id: 2,
  billing_cycle: 'MONTHLY',
  status: 'ACTIVE',
  current_period_start: new Date('2026-05-01'),
  current_period_end: new Date('2026-06-01'),
  provider_subscription_id: null,
};

describe('SubscriptionService', () => {
  const organizationService = {
    requireOrganizationByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserInternalIdByPublicId: vi.fn().mockResolvedValue(10),
    updateStripeCustomerIdForOrganization: vi.fn(),
  } as unknown as OrganizationService;

  const planService = {
    requirePlanRecordByPublicId: vi.fn().mockResolvedValue(plan),
    requirePlanRecordByInternalId: vi.fn().mockResolvedValue(plan),
  } as unknown as PlanService;

  const repository = {
    listByOrganization: vi.fn().mockResolvedValue([subscriptionRow]),
    findByPublicId: vi.fn().mockResolvedValue(subscriptionRow),
    create: vi.fn().mockResolvedValue(subscriptionRow),
    update: vi.fn().mockResolvedValue({ ...subscriptionRow, cancel_at_period_end: true }),
    syncFromStripeProviderSubscription: vi.fn(),
    markCanceledByProviderSubscriptionId: vi.fn(),
  } as unknown as SubscriptionRepository;

  const paymentProvider = new StripePaymentProvider(organizationService);

  const service = new SubscriptionService(
    organizationService,
    planService,
    repository,
    paymentProvider,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.findByPublicId).mockResolvedValue(subscriptionRow as never);
    vi.mocked(repository.update).mockResolvedValue(subscriptionRow as never);
  });

  it('list returns subscriptions for organization', async () => {
    const result = await service.list('org_public');
    expect(result).toEqual([subscriptionRow]);
  });

  it('get returns subscription when found', async () => {
    const result = await service.get('org_public', 'sub_public');
    expect(result.public_id).toBe('sub_public');
  });

  it('get throws when subscription missing', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(service.get('org_public', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create persists local subscription without Stripe', async () => {
    const result = await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'monthly' },
      'user_public',
    );
    expect(repository.create).toHaveBeenCalled();
    expect(result).toEqual(subscriptionRow);
  });

  it('update sets cancel_at_period_end', async () => {
    await service.update('org_public', 'sub_public', { cancel_at_period_end: true });
    expect(repository.update).toHaveBeenCalledWith('sub_public', 1, {
      cancel_at_period_end: true,
    });
  });

  it('changePlan updates plan on subscription', async () => {
    await service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' });
    expect(repository.update).toHaveBeenCalled();
  });

  it('cancel marks subscription to cancel at period end', async () => {
    await service.cancel('org_public', 'sub_public');
    expect(repository.update).toHaveBeenCalledWith(
      'sub_public',
      1,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
  });

  it('resume reactivates subscription', async () => {
    await service.resume('org_public', 'sub_public');
    expect(repository.update).toHaveBeenCalledWith(
      'sub_public',
      1,
      expect.objectContaining({ cancel_at_period_end: false, status: 'ACTIVE' }),
    );
  });

  it('create uses Stripe when configured and plan has price id', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_monthly',
    } as never);

    await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'monthly' },
      'user_public',
    );

    expect(stripeMocks.createStripeCustomer).toHaveBeenCalled();
    expect(stripeMocks.createStripeSubscription).toHaveBeenCalled();
    expect(organizationService.updateStripeCustomerIdForOrganization).toHaveBeenCalled();
  });

  it('cancel calls Stripe when provider subscription id exists', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);

    await service.cancel('org_public', 'sub_public');
    expect(stripeMocks.cancelStripeSubscription).toHaveBeenCalledWith('sub_stripe', true);
  });

  it('resume calls Stripe when provider subscription id exists', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);

    await service.resume('org_public', 'sub_public');
    expect(stripeMocks.resumeStripeSubscription).toHaveBeenCalledWith('sub_stripe');
  });

  it('changePlan updates Stripe subscription when configured', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_monthly',
    } as never);

    await service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' });
    expect(stripeMocks.updateStripeSubscription).toHaveBeenCalled();
  });

  it('create compensates Stripe subscription when local create fails', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_monthly',
    } as never);
    vi.mocked(repository.create).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.create(
        'org_public',
        { plan_id: 'plan_public', billing_cycle: 'monthly' },
        'user_public',
      ),
    ).rejects.toThrow('database unavailable');

    expect(stripeMocks.cancelStripeSubscription).toHaveBeenCalledWith('sub_stripe', false);
  });

  it('changePlan reverts Stripe price when local update fails after Stripe update', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
      billing_cycle: 'MONTHLY',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_new',
    } as never);
    vi.mocked(planService.requirePlanRecordByInternalId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_old',
    } as never);
    vi.mocked(repository.update).mockResolvedValueOnce(null);

    await expect(
      service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(stripeMocks.updateStripeSubscription).toHaveBeenCalledTimes(2);
    expect(stripeMocks.updateStripeSubscription).toHaveBeenLastCalledWith('sub_stripe', {
      priceId: 'price_old',
    });
  });

  it('create falls back to local subscription when Stripe create fails', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_monthly',
    } as never);
    stripeMocks.createStripeSubscription.mockRejectedValueOnce(new Error('stripe down'));

    await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'monthly' },
      'user_public',
    );
    expect(repository.create).toHaveBeenCalled();
  });

  it('syncFromStripeProviderSubscription and markCanceled delegate to repository', async () => {
    const eventDate = new Date();
    await service.syncFromStripeProviderSubscription('sub_stripe', { status: 'ACTIVE' }, eventDate);
    await service.markCanceledByStripeProviderSubscriptionId('sub_stripe', eventDate);
    expect(repository.syncFromStripeProviderSubscription).toHaveBeenCalled();
    expect(repository.markCanceledByProviderSubscriptionId).toHaveBeenCalled();
  });

  it('cancel and resume continue when Stripe calls fail', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);
    stripeMocks.cancelStripeSubscription.mockRejectedValueOnce(new Error('stripe cancel failed'));
    stripeMocks.resumeStripeSubscription.mockRejectedValueOnce(new Error('stripe resume failed'));

    await service.cancel('org_public', 'sub_public');
    await service.resume('org_public', 'sub_public');
    expect(repository.update).toHaveBeenCalled();
  });

  it('update throws when repository returns no row', async () => {
    vi.mocked(repository.update).mockResolvedValue(null);
    await expect(
      service.update('org_public', 'sub_public', { cancel_at_period_end: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changePlan throws when subscription is missing', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(
      service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changePlan throws when update returns no row', async () => {
    vi.mocked(repository.update).mockResolvedValue(null);
    await expect(
      service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('cancel and resume throw when subscription is missing or update fails', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(service.cancel('org_public', 'sub_public')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.resume('org_public', 'sub_public')).rejects.toBeInstanceOf(NotFoundError);

    vi.mocked(repository.findByPublicId).mockResolvedValue(subscriptionRow as never);
    vi.mocked(repository.update).mockResolvedValue(null);
    await expect(service.cancel('org_public', 'sub_public')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.resume('org_public', 'sub_public')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create reuses existing Stripe customer and supports yearly price and trial end', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(organizationService.requireOrganizationByPublicId).mockResolvedValue({
      ...organization,
      stripe_customer_id: 'cus_existing',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_yearly_id: 'price_yearly',
    } as never);

    await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'yearly', trial_end: '2026-12-31T00:00:00.000Z' },
      'user_public',
    );

    expect(stripeMocks.createStripeCustomer).not.toHaveBeenCalled();
    expect(stripeMocks.createStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_existing',
        priceId: 'price_yearly',
        trialEnd: expect.any(Number),
      }),
    );
  });

  it('create logs and continues when plan has no Stripe price id', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: null,
      stripe_price_yearly_id: null,
    } as never);

    await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'monthly' },
      'user_public',
    );
    expect(stripeMocks.createStripeSubscription).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalled();
  });

  it('changePlan compensates with yearly Stripe price when billing cycle is yearly', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
      billing_cycle: 'YEARLY',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_yearly_id: 'price_new_yearly',
    } as never);
    vi.mocked(planService.requirePlanRecordByInternalId).mockResolvedValue({
      ...plan,
      stripe_price_yearly_id: 'price_old_yearly',
    } as never);
    vi.mocked(repository.update).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' }),
    ).rejects.toThrow('database unavailable');

    expect(stripeMocks.updateStripeSubscription).toHaveBeenLastCalledWith('sub_stripe', {
      priceId: 'price_old_yearly',
    });
  });

  it('changePlan does not compensate when previous plan has no Stripe price id', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: 'price_new',
    } as never);
    vi.mocked(planService.requirePlanRecordByInternalId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: null,
      stripe_price_yearly_id: null,
    } as never);
    vi.mocked(repository.update).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' }),
    ).rejects.toThrow('database unavailable');

    expect(stripeMocks.updateStripeSubscription).toHaveBeenCalledTimes(1);
  });

  it('create persists without created_by_user_id when user cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await service.create(
      'org_public',
      { plan_id: 'plan_public', billing_cycle: 'monthly' },
      'missing_user',
    );
    const createPayload = vi.mocked(repository.create).mock.calls[0]![0] as unknown as Record<
      string,
      unknown
    >;
    expect(createPayload).not.toHaveProperty('created_by_user_id');
  });

  it('changePlan continues when Stripe update fails or price id is missing', async () => {
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...subscriptionRow,
      provider_subscription_id: 'sub_stripe',
    } as never);
    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_monthly_id: null,
      stripe_price_yearly_id: null,
    } as never);

    await service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' });
    expect(stripeMocks.updateStripeSubscription).not.toHaveBeenCalled();

    vi.mocked(planService.requirePlanRecordByPublicId).mockResolvedValue({
      ...plan,
      stripe_price_yearly_id: 'price_yearly',
    } as never);
    stripeMocks.updateStripeSubscription.mockRejectedValueOnce(new Error('stripe update failed'));
    await service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' });
    expect(repository.update).toHaveBeenCalled();
  });
});
