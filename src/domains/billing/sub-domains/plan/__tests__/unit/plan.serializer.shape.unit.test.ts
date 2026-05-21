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
        'id',
        'is_active',
        'name',
        'price_monthly',
        'price_yearly',
        'updated_at',
      ].sort(),
    );
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
