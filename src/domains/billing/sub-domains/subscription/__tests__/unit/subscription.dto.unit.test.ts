import { describe, expect, it } from 'vitest';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  listInvoicesQueryDto,
  subscriptionIdParamsDto,
  UpdateSubscriptionDto,
} from '@/domains/billing/sub-domains/subscription/subscription.dto.js';

/**
 * The subscription schemas, and one deliberately empty schema that carries a real invariant.
 *
 * `UpdateSubscriptionDto` is `z.object({}).strict()` because of sec-B1: `cancel_at_period_end` used
 * to be accepted on PATCH, but the handler never called Stripe. The local row would flip to
 * "cancelling" while Stripe went on charging the next renewal, with no webhook to reconcile the
 * divergence. The fix was to route both toggles through `/cancel` and `/resume`, which do call
 * Stripe — and to let `.strict()` turn the old request into a loud 422.
 *
 * An empty schema reads like a placeholder, which is exactly the risk: someone adding a
 * "harmless" billing-state field back to it would silently reopen the divergence. The test below
 * names the field so the reason survives.
 */
describe('subscription.dto', () => {
  describe('UpdateSubscriptionDto (sec-B1)', () => {
    it('accepts an empty body', () => {
      expect(UpdateSubscriptionDto.safeParse({}).success).toBe(true);
    });

    it.each([
      ['cancel_at_period_end true', { cancel_at_period_end: true }],
      ['cancel_at_period_end false', { cancel_at_period_end: false }],
    ])('rejects %s — that toggle must go through /cancel or /resume', (_label, body) => {
      // Accepting it here would flip the local row without calling Stripe, and nothing would
      // reconcile the two afterwards.
      expect(UpdateSubscriptionDto.safeParse(body).success).toBe(false);
    });

    it.each([
      ['a status', { status: 'ACTIVE' }],
      ['a plan id', { plan_id: 'pln_enterprise' }],
      ['a period end', { current_period_end: '2030-01-01T00:00:00.000Z' }],
      ['a Stripe subscription id', { stripe_subscription_id: 'sub_evil' }],
      ['a price', { price: 0 }],
    ])('rejects %s (.strict)', (_label, body) => {
      expect(UpdateSubscriptionDto.safeParse(body).success).toBe(false);
    });
  });

  describe('CreateSubscriptionDto', () => {
    const valid = { plan_id: 'pln_abcdefghijklmnopqrst', billing_cycle: 'monthly' } as const;

    it('accepts a well-formed body', () => {
      expect(CreateSubscriptionDto.safeParse(valid).success).toBe(true);
    });

    it.each([['monthly'], ['yearly']])('accepts billing_cycle %s', (billing_cycle) => {
      expect(CreateSubscriptionDto.safeParse({ ...valid, billing_cycle }).success).toBe(true);
    });

    it.each([
      ['wrong case', 'MONTHLY'],
      ['an unsupported cycle', 'weekly'],
      ['an empty string', ''],
      ['null', null],
    ])('rejects billing_cycle %s', (_label, billing_cycle) => {
      // The cycle picks the price on the plan; an unmodelled value must not reach Stripe.
      expect(CreateSubscriptionDto.safeParse({ ...valid, billing_cycle }).success).toBe(false);
    });

    it('requires both fields', () => {
      expect(CreateSubscriptionDto.safeParse({ plan_id: valid.plan_id }).success).toBe(false);
      expect(CreateSubscriptionDto.safeParse({ billing_cycle: 'monthly' }).success).toBe(false);
    });

    it('rejects a plan_id over 255 characters', () => {
      expect(CreateSubscriptionDto.safeParse({ ...valid, plan_id: 'a'.repeat(256) }).success).toBe(
        false,
      );
    });

    it('trims the plan_id', () => {
      expect(CreateSubscriptionDto.parse({ ...valid, plan_id: '  pln_abc  ' }).plan_id).toBe(
        'pln_abc',
      );
    });

    it.each([
      ['an organization id', { organization_id: 'org_other' }],
      ['a price override', { price: 0 }],
      ['a status', { status: 'ACTIVE' }],
      ['a trial extension', { trial_end: '2099-01-01T00:00:00.000Z' }],
      ['a Stripe customer id', { stripe_customer_id: 'cus_evil' }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      // Price, status and trial are server-side facts; a caller must not set any of them.
      expect(CreateSubscriptionDto.safeParse({ ...valid, ...extra }).success).toBe(false);
    });
  });

  describe('ChangePlanDto', () => {
    it('accepts a target plan id', () => {
      expect(ChangePlanDto.safeParse({ plan_id: 'pln_abcdefghijklmnopqrst' }).success).toBe(true);
    });

    it('requires the plan_id', () => {
      expect(ChangePlanDto.safeParse({}).success).toBe(false);
    });

    it('rejects a plan_id over 255 characters', () => {
      expect(ChangePlanDto.safeParse({ plan_id: 'a'.repeat(256) }).success).toBe(false);
    });

    it.each([
      ['a billing cycle', { billing_cycle: 'yearly' }],
      ['a proration flag', { proration_behavior: 'none' }],
      ['a price', { price: 0 }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      // Change-plan takes the target plan and nothing else — proration is the service's decision.
      expect(ChangePlanDto.safeParse({ plan_id: 'pln_abc', ...extra }).success).toBe(false);
    });
  });

  describe('listInvoicesQueryDto', () => {
    it('accepts an empty query', () => {
      expect(listInvoicesQueryDto.safeParse({}).success).toBe(true);
    });

    it('leaves limit undefined when omitted', () => {
      // Deliberately `.optional()` rather than `.default()`: a defaulted param serializes as
      // `required` in OpenAPI, which would be a breaking change on a pre-existing route. The
      // default is applied in the service.
      expect(listInvoicesQueryDto.parse({})).not.toHaveProperty('limit');
    });

    it('coerces a numeric string limit (query params arrive as strings)', () => {
      expect(listInvoicesQueryDto.parse({ limit: '25' }).limit).toBe(25);
    });

    it('accepts the maximum Stripe page size', () => {
      expect(listInvoicesQueryDto.parse({ limit: PAGINATION.MAX_LIMIT }).limit).toBe(
        PAGINATION.MAX_LIMIT,
      );
    });

    it('rejects a limit above the Stripe page maximum', () => {
      expect(listInvoicesQueryDto.safeParse({ limit: PAGINATION.MAX_LIMIT + 1 }).success).toBe(
        false,
      );
    });

    it.each([
      ['zero', 0],
      ['a negative limit', -1],
      ['a fractional limit', 2.5],
      ['free text', 'all'],
    ])('rejects %s', (_label, limit) => {
      expect(listInvoicesQueryDto.safeParse({ limit }).success).toBe(false);
    });

    it('accepts a Stripe invoice cursor', () => {
      expect(listInvoicesQueryDto.safeParse({ after: 'in_1234567890' }).success).toBe(true);
    });

    it('rejects a cursor over 512 characters', () => {
      expect(listInvoicesQueryDto.safeParse({ after: 'a'.repeat(513) }).success).toBe(false);
    });

    it('rejects an unknown query parameter', () => {
      // Invoices are proxied to Stripe; an unknown key must not become an unvetted passthrough.
      expect(listInvoicesQueryDto.safeParse({ customer: 'cus_other' }).success).toBe(false);
    });
  });

  describe('subscriptionIdParamsDto', () => {
    it('accepts a well-formed id', () => {
      expect(
        subscriptionIdParamsDto.safeParse({ subscription_id: 'sub_abcdefghijklmnopqrst' }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', { subscription_id: '' }],
      ['an id over 28 characters', { subscription_id: 's'.repeat(29) }],
      ['a missing id', {}],
      ['a numeric id', { subscription_id: 42 }],
      ['an extra param', { subscription_id: 'sub_abc', organization_id: 'org_other' }],
    ])('rejects %s', (_label, input) => {
      expect(subscriptionIdParamsDto.safeParse(input).success).toBe(false);
    });
  });
});
