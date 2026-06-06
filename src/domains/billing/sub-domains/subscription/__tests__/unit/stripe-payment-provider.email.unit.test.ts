import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * sec-B11: the Stripe customer email used to be derived from the tenant-
 * controlled `organization.slug` — `billing@${slug}.com` — so an org with
 * slug `google` would be registered with Stripe as `billing@google.com`,
 * routing every Stripe-originated email (receipts, dunning, dispute
 * notifications) to a third-party domain. Bounces accumulated, deliverability
 * on the legitimate domain degraded, and the platform took third-party
 * abuse complaints. The fix swaps in a per-organization plus-addressed
 * mailbox on the domain we already use for outbound transactional mail
 * (derived from `EMAIL_FROM_ADDRESS`).
 */

const stripeMocks = vi.hoisted(() => ({
  isStripeConfigured: vi.fn(() => true),
  createStripeCustomer: vi.fn(),
  createStripeSubscription: vi.fn(),
  cancelStripeSubscription: vi.fn(),
  resumeStripeSubscription: vi.fn(),
  updateStripeSubscription: vi.fn(),
}));

vi.mock('@/infrastructure/payment/stripe.client.js', () => stripeMocks);

const envMock = vi.hoisted(() => ({
  env: { EMAIL_FROM_ADDRESS: 'noreply@platform.example.com' },
}));

vi.mock('@/shared/config/env.config.js', () => envMock);

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { StripePaymentProvider } from '@/domains/billing/sub-domains/subscription/stripe-payment-provider.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';

const baseOrganization = {
  public_id: 'org_pub_abc',
  slug: 'google', // sec-B11: the historical foot-gun input — must NOT show up in the email
  name: 'Test Organization',
  stripe_customer_id: null as string | null,
};

const basePlan = {
  id: 1,
  public_id: 'plan_pub_test',
  name: 'Test Plan',
  stripe_price_monthly_id: 'price_monthly',
  stripe_price_yearly_id: 'price_yearly',
};

function makeProvider() {
  const organizationService = {
    updateStripeCustomerIdForOrganization: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationService;
  return new StripePaymentProvider(organizationService);
}

describe('StripePaymentProvider.createSubscription — sec-B11 customer email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMocks.isStripeConfigured.mockReturnValue(true);
    stripeMocks.createStripeCustomer.mockResolvedValue({ id: 'cus_new' });
    stripeMocks.createStripeSubscription.mockResolvedValue({
      id: 'sub_new',
      status: 'active',
      latest_invoice: { hosted_invoice_url: null },
    });
  });

  it('uses billing+<public_id>@<EMAIL_FROM_ADDRESS domain> and never embeds the tenant slug', async () => {
    envMock.env.EMAIL_FROM_ADDRESS = 'noreply@platform.example.com';
    const provider = makeProvider();

    await provider.createSubscription({
      organization: baseOrganization as never,
      plan: basePlan as never,
      billingCycle: 'monthly',
    });

    expect(stripeMocks.createStripeCustomer).toHaveBeenCalledOnce();
    const [args] = stripeMocks.createStripeCustomer.mock.calls[0] as [{ email: string }];
    // Plus-addressed mailbox on the platform's transactional-mail domain.
    expect(args.email).toBe('billing+org_pub_abc@platform.example.com');
    // The tenant-controlled slug MUST NOT appear in the address — that was
    // the original B11 foot-gun.
    expect(args.email).not.toContain('google');
  });

  it('falls back to an RFC-2606-ish reserved domain when EMAIL_FROM_ADDRESS is unset (operator misconfiguration)', async () => {
    envMock.env.EMAIL_FROM_ADDRESS = undefined as never;
    const provider = makeProvider();

    await provider.createSubscription({
      organization: baseOrganization as never,
      plan: basePlan as never,
      billingCycle: 'monthly',
    });

    const [args] = stripeMocks.createStripeCustomer.mock.calls[0] as [{ email: string }];
    // The fallback domain must NOT be the tenant slug; we deliberately route
    // to an unowned reserved-style domain so deliverability stays our problem
    // (visible in Stripe Dashboard as bouncing) rather than a third party's.
    expect(args.email).toBe('billing+org_pub_abc@invalid');
    expect(args.email).not.toContain('google');
  });
});
