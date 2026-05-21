import { describe, expect, it } from 'vitest';
import { PlanSerializer } from '@/domains/billing/sub-domains/plan/plan.serializer.js';
import type { PlanOutput } from '@/domains/billing/sub-domains/plan/plan.types.js';

describe('plan.serializer', () => {
  it('PlanSerializer is pass-through for one and many', () => {
    const plan = { id: 'plan-1', name: 'Pro' } as PlanOutput;
    expect(PlanSerializer.one(plan)).toBe(plan);
    expect(PlanSerializer.many([plan])).toEqual([plan]);
  });
});
