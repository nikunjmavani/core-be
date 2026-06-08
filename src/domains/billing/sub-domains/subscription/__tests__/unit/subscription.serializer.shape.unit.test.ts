import { describe, expect, it } from 'vitest';
import { SubscriptionSerializer } from '@/domains/billing/sub-domains/subscription/subscription.serializer.js';

// sec-T #17 promoted the serializer from identity passthrough to a typed
// allowlist. The previous regression-guard ("identity returns the same object,
// keys preserved") is now ANTI-property — exactly the leak the audit flagged.
// The new property: the public output shape is fixed and never contains
// bigserials, Stripe-side ids, or the internal watermark column.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    public_id: 'sub_publicpublicpublic',
    status: 'ACTIVE',
    billing_cycle: 'monthly',
    current_period_start: '2026-01-01T00:00:00.000Z',
    current_period_end: '2026-02-01T00:00:00.000Z',
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    provider: 'stripe',
    plan_public_id: 'pln_publicpublicpublic',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as never;
}

describe('subscription.serializer shape (sec-T #17 strip-only regression-guard)', () => {
  it('returns the documented public allowlist and drops every internal field', () => {
    const result = SubscriptionSerializer.one(
      makeRow({
        // Wide input: every leak-class field. Each must be absent from the output.
        id: 17,
        organization_id: 7,
        plan_id: 3,
        provider_subscription_id: 'stripe_sub_xyz',
        provider_customer_id: 'cus_xyz',
        last_stripe_event_created_at: '2026-01-02T00:00:00.000Z',
        created_by_user_id: 9,
        updated_by_user_id: null,
      }),
    );

    expect(Object.keys(result).sort()).toEqual(
      [
        'billing_cycle',
        'cancel_at_period_end',
        'canceled_at',
        'created_at',
        'current_period_end',
        'current_period_start',
        'id',
        'plan_id',
        'provider',
        'status',
        'trial_end',
        'updated_at',
      ].sort(),
    );
  });

  it('sec-re-07: emits plan_id as the joined plan public id (not the internal bigserial)', () => {
    // sec-T #17 correctly stripped the bigserial `plan_id` from the response,
    // but did not add a public-id substitute — clients posting ChangePlanDto
    // (which takes a plan_id public id) received a response that didn't echo
    // which plan they were on. The fix joins billing.plans and projects
    // plan.public_id as `plan_public_id` on the row, surfaced as `plan_id`
    // in the response (the documented public-facing field name).
    const result = SubscriptionSerializer.one(
      makeRow({
        plan_id: 99, // bigserial — must NOT appear in the output
        plan_public_id: 'pln_specificplanpublic',
      }),
    );
    expect(result).toHaveProperty('plan_id', 'pln_specificplanpublic');
    expect((result as { plan_id: unknown }).plan_id).not.toBe(99);
  });

  it('sec-re-07: plan_id is null when the joined plan public id is missing (defensive)', () => {
    const result = SubscriptionSerializer.one(makeRow({ plan_public_id: null }));
    expect(result).toHaveProperty('plan_id', null);
  });

  it('drops Stripe-side ids even when present on the input row', () => {
    const result = SubscriptionSerializer.one(
      makeRow({
        provider: 'stripe',
        provider_subscription_id: 'stripe_sub_xyz',
        provider_customer_id: 'cus_xyz',
      }),
    );
    expect(result).not.toHaveProperty('provider_subscription_id');
    expect(result).not.toHaveProperty('provider_customer_id');
    // `provider` (the literal "stripe") is retained so callers can branch UI.
    expect(result).toHaveProperty('provider', 'stripe');
  });

  it('SubscriptionSerializer.many preserves order and applies the strip-only projection per row', () => {
    const a = makeRow({ public_id: 'sub_a_publicpublicpub' });
    const b = makeRow({ public_id: 'sub_b_publicpublicpub', status: 'PAST_DUE' });
    const c = makeRow({ public_id: 'sub_c_publicpublicpub', status: 'CANCELED' });
    const result = SubscriptionSerializer.many([a, b, c]);
    expect(result.map((entry) => entry.id)).toEqual([
      'sub_a_publicpublicpub',
      'sub_b_publicpublicpub',
      'sub_c_publicpublicpub',
    ]);
    expect(result.map((entry) => entry.status)).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELED']);
  });
});
