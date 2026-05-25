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
import type { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import type { PaymentProvider } from '@/domains/billing/sub-domains/subscription/payment-provider.port.js';

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
const baseSubscriptionRow = {
  id: 3,
  public_id: 'sub_public',
  organization_id: 1,
  plan_id: 2,
  billing_cycle: 'MONTHLY' as const,
  status: 'ACTIVE' as const,
  cancel_at_period_end: false,
  current_period_start: new Date('2026-05-01T00:00:00.000Z'),
  current_period_end: new Date('2026-06-01T00:00:00.000Z'),
  provider: 'stripe' as const,
  provider_subscription_id: 'sub_provider',
};

function buildService() {
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
    listByOrganization: vi.fn().mockResolvedValue([]),
    findByPublicId: vi.fn().mockResolvedValue(baseSubscriptionRow),
    create: vi.fn().mockResolvedValue(baseSubscriptionRow),
    update: vi.fn().mockResolvedValue({ ...baseSubscriptionRow, cancel_at_period_end: true }),
    syncFromStripeProviderSubscription: vi.fn(),
    markCanceledByProviderSubscriptionId: vi.fn(),
  } as unknown as SubscriptionRepository;

  const paymentProvider = {
    isConfigured: vi.fn().mockReturnValue(true),
    getProviderPriceId: vi.fn().mockReturnValue('price_provider'),
    createSubscription: vi.fn().mockResolvedValue({ providerSubscriptionId: 'sub_provider' }),
    cancelSubscriptionAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
    resumeSubscription: vi.fn().mockResolvedValue(undefined),
    updateSubscriptionPrice: vi.fn().mockResolvedValue(true),
    compensateFailedCreate: vi.fn().mockResolvedValue(undefined),
    compensatePlanChange: vi.fn().mockResolvedValue(undefined),
  } satisfies PaymentProvider;

  const service = new SubscriptionService(
    organizationService,
    planService,
    repository,
    paymentProvider,
  );

  return { service, organizationService, planService, repository, paymentProvider };
}

describe('SubscriptionService cancel / resume / changePlan guards', () => {
  let context: ReturnType<typeof buildService>;

  beforeEach(() => {
    context = buildService();
  });

  it('cancel still calls Stripe and persists when subscription has provider id', async () => {
    const { service, repository, paymentProvider } = context;

    await service.cancel('org_public', 'sub_public');

    expect(paymentProvider.cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith('sub_provider');
    expect(repository.update).toHaveBeenCalledWith(
      'sub_public',
      organization.id,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
  });

  it('cancel throws NotFoundError when subscription is missing (no Stripe call)', async () => {
    const { service, repository, paymentProvider } = context;
    vi.mocked(repository.findByPublicId).mockResolvedValueOnce(null);

    await expect(service.cancel('org_public', 'sub_public')).rejects.toBeInstanceOf(NotFoundError);
    expect(paymentProvider.cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('resume calls Stripe and clears cancel_at_period_end / sets status ACTIVE', async () => {
    const { service, repository, paymentProvider } = context;

    await service.resume('org_public', 'sub_public');

    expect(paymentProvider.resumeSubscription).toHaveBeenCalledWith('sub_provider');
    expect(repository.update).toHaveBeenCalledWith(
      'sub_public',
      organization.id,
      expect.objectContaining({ cancel_at_period_end: false, status: 'ACTIVE' }),
    );
  });

  it('changePlan does not call paymentProvider when subscription has no provider id', async () => {
    const { service, repository, paymentProvider } = context;
    vi.mocked(repository.findByPublicId).mockResolvedValueOnce({
      ...baseSubscriptionRow,
      provider_subscription_id: null,
    } as never);

    await service.changePlan('org_public', 'sub_public', { plan_id: 'plan_public' });

    expect(paymentProvider.updateSubscriptionPrice).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalled();
  });
});
