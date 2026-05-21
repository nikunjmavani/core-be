import { database } from '@/infrastructure/database/connection.js';
import { plans } from '@/domains/billing/sub-domains/plan/plan.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

export interface CreatePlanOptions {
  name?: string;
  priceMonthly?: string;
  priceYearly?: string;
  currency?: string;
}

/**
 * Create a test plan in the database.
 */
export async function createTestPlan(options: CreatePlanOptions = {}) {
  const publicId = generatePublicId();

  const [plan] = await database
    .insert(plans)
    .values({
      public_id: publicId,
      name: options.name ?? `Test Plan ${publicId}`,
      price_monthly: options.priceMonthly ?? '9.99',
      price_yearly: options.priceYearly ?? '99.99',
      currency: options.currency ?? 'USD',
      features: {},
    })
    .returning();

  return plan!;
}
