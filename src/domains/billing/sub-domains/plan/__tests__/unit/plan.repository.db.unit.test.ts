import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import { PlanRepository } from '@/domains/billing/sub-domains/plan/plan.repository.js';
import { database } from '@/infrastructure/database/connection.js';
import { plans } from '@/domains/billing/sub-domains/plan/plan.schema.js';
import { eq } from 'drizzle-orm';

describe('PlanRepository (database)', () => {
  const repository = new PlanRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('finds active plans and looks up by public id and internal id', async () => {
    const activePlan = await createTestPlan({ name: 'Active Plan' });
    const inactivePlan = await createTestPlan({ name: 'Inactive Plan' });
    await database.update(plans).set({ is_active: false }).where(eq(plans.id, inactivePlan.id));

    const activePlans = await repository.findAllActive();
    expect(activePlans.some((row) => row.public_id === activePlan.public_id)).toBe(true);
    expect(activePlans.some((row) => row.public_id === inactivePlan.public_id)).toBe(false);

    const byPublicId = await repository.findByPublicId(activePlan.public_id);
    expect(byPublicId?.name).toBe('Active Plan');

    const missingPublicId = await repository.findByPublicId('not_a_real_public_id');
    expect(missingPublicId).toBeNull();

    const byId = await repository.findById(activePlan.id);
    expect(byId?.public_id).toBe(activePlan.public_id);

    const missingId = await repository.findById(9_999_999);
    expect(missingId).toBeNull();
  });
});
