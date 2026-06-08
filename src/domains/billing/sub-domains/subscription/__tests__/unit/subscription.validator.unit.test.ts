import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateChangePlan,
  validateCreateSubscription,
  validateUpdateSubscription,
} from '@/domains/billing/sub-domains/subscription/subscription.validator.js';

describe('subscription.validator', () => {
  it('validateCreateSubscription accepts plan and billing_cycle', () => {
    expect(validateCreateSubscription({ plan_id: 'plan-1', billing_cycle: 'monthly' })).toEqual({
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
    });
  });

  it('validateUpdateSubscription accepts empty body (sec-B1: no billing-state fields are PATCHable)', () => {
    expect(validateUpdateSubscription({})).toEqual({});
  });

  it('validateUpdateSubscription rejects cancel_at_period_end (sec-B1: use /cancel and /resume instead)', () => {
    // PATCHing cancel_at_period_end used to silently diverge from Stripe — the local row
    // flipped but no Stripe call was made and no webhook reconciled. Clients must route
    // those toggles through the dedicated /cancel and /resume endpoints.
    expect(() => validateUpdateSubscription({ cancel_at_period_end: true })).toThrow(
      ValidationError,
    );
  });

  it('validateChangePlan accepts plan_id', () => {
    expect(validateChangePlan({ plan_id: 'plan-pro' })).toEqual({ plan_id: 'plan-pro' });
  });

  it('validateCreateSubscription throws for invalid billing_cycle', () => {
    expect(() => validateCreateSubscription({ plan_id: 'p', billing_cycle: 'weekly' })).toThrow(
      ValidationError,
    );
  });
});
