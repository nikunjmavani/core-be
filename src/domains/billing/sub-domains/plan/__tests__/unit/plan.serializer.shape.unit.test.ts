import { describe, expect, it } from 'vitest';
import { PlanSerializer } from '@/domains/billing/sub-domains/plan/plan.serializer.js';
import type { PlanOutput } from '@/domains/billing/sub-domains/plan/plan.types.js';

describe('plan.serializer shape (regression-guard)', () => {
  const samplePlan: PlanOutput = {
    id: 'pln_01',
    name: 'Pro',
    description: 'For growing teams',
    price_monthly: '29.00',
    price_yearly: '290.00',
    currency: 'USD',
    is_active: true,
    // REQ-4: features map + typed seat limit are part of the public shape.
    features: { priority_support: true, audit_log: true },
    limits: { seats: 25 },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };

  it('PlanSerializer.one exposes only the documented PlanOutput fields', () => {
    const result = PlanSerializer.one(samplePlan);
    expect(Object.keys(result).sort()).toEqual(
      [
        'created_at',
        'currency',
        'description',
        'features',
        'id',
        'is_active',
        'limits',
        'name',
        'price_monthly',
        'price_yearly',
        'updated_at',
      ].sort(),
    );
  });

  it('REQ-4: PlanSerializer.one surfaces features verbatim and the typed seat limit', () => {
    const result = PlanSerializer.one(samplePlan);
    expect(result.features).toEqual({ priority_support: true, audit_log: true });
    expect(result.limits).toEqual({ seats: 25 });
  });

  it('PlanSerializer.one preserves a null description without coercion', () => {
    const planWithoutDescription: PlanOutput = { ...samplePlan, description: null };
    const result = PlanSerializer.one(planWithoutDescription);
    expect(result.description).toBeNull();
  });

  it('PlanSerializer.many preserves input order across plans', () => {
    const planA: PlanOutput = { ...samplePlan, id: 'pln_a', name: 'A' };
    const planB: PlanOutput = { ...samplePlan, id: 'pln_b', name: 'B' };
    const planC: PlanOutput = { ...samplePlan, id: 'pln_c', name: 'C' };
    const result = PlanSerializer.many([planA, planB, planC]);
    expect(result.map((plan) => plan.id)).toEqual(['pln_a', 'pln_b', 'pln_c']);
  });
});
