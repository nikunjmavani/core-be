/** Billing resource schemas. */
// ── Plan ──
export const planSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    price_monthly: { type: 'string' },
    price_yearly: { type: 'string' },
    currency: { type: 'string' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const planExample = {
  id: 'pln_j5h8t3rwy6m1k9n2',
  name: 'Pro',
  description: 'For growing teams that need more power and flexibility',
  price_monthly: '29.00',
  price_yearly: '290.00',
  currency: 'USD',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// ── Subscription ──
export const subscriptionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organization_id: { type: 'string' },
    plan_id: { type: 'string' },
    status: { type: 'string' },
    billing_cycle: { type: 'string' },
    current_period_start: { type: 'string', format: 'date-time' },
    current_period_end: { type: 'string', format: 'date-time' },
    cancel_at_period_end: { type: 'boolean' },
    trial_end: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const subscriptionExample = {
  id: 'sub_w1r4x9k3m7n2p5q8',
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  plan_id: 'pln_j5h8t3rwy6m1k9n2',
  status: 'ACTIVE',
  billing_cycle: 'monthly',
  current_period_start: '2026-02-01T00:00:00.000Z',
  current_period_end: '2026-03-01T00:00:00.000Z',
  cancel_at_period_end: false,
  trial_end: null,
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};
