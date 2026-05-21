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

  it('validateUpdateSubscription accepts cancel_at_period_end', () => {
    expect(validateUpdateSubscription({ cancel_at_period_end: true })).toEqual({
      cancel_at_period_end: true,
    });
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
