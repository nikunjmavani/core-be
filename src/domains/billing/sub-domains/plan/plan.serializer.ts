import type { PlanOutput } from './plan.types.js';

/**
 * Identity serializer for plan responses; rows are already shaped as
 * {@link PlanOutput} by {@link PlanService}, so this only enforces the
 * one/many response convention used across domains.
 */
export const PlanSerializer = {
  one(plan: PlanOutput): PlanOutput {
    return plan;
  },
  many(plans: PlanOutput[]): PlanOutput[] {
    return plans;
  },
};
