import { describe, it, expect } from 'vitest';
import { StripePaymentProvider } from '@/domains/billing/sub-domains/subscription/stripe-payment-provider.js';
import type { PaymentProvider } from '@/domains/billing/sub-domains/subscription/payment-provider.port.js';

describe('PaymentProvider port', () => {
  it('StripePaymentProvider implements PaymentProvider', () => {
    const provider: PaymentProvider = new StripePaymentProvider({} as never);
    expect(typeof provider.isConfigured).toBe('function');
    expect(typeof provider.getProviderPriceId).toBe('function');
    expect(typeof provider.createSubscription).toBe('function');
    expect(typeof provider.cancelSubscriptionAtPeriodEnd).toBe('function');
    expect(typeof provider.resumeSubscription).toBe('function');
    expect(typeof provider.updateSubscriptionPrice).toBe('function');
    expect(typeof provider.compensateFailedCreate).toBe('function');
    expect(typeof provider.compensatePlanChange).toBe('function');
  });
});
