import type { PlanOutput } from './plan.types.js';

export const PlanSerializer = {
  one(plan: PlanOutput): PlanOutput {
    return plan;
  },
  many(plans: PlanOutput[]): PlanOutput[] {
    return plans;
  },
};
