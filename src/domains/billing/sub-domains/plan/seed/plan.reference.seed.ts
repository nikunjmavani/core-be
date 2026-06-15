/**
 * Billing plan seed — default plans (Free, Starter, Pro).
 * Domain-owned; used by scripts/seed orchestration.
 */
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { plans } from '@/domains/billing/sub-domains/plan/plan.schema.js';

/** Free / Starter / Pro pricing baseline used by `pnpm db:seed`. */
export const DEFAULT_PLANS = [
  { name: 'Free', price_monthly: '0.00', price_yearly: '0.00' },
  { name: 'Starter', price_monthly: '29.00', price_yearly: '290.00' },
  { name: 'Pro', price_monthly: '99.00', price_yearly: '990.00' },
];

/**
 * Idempotently inserts the {@link DEFAULT_PLANS} catalog (or a caller-supplied
 * list), skipping rows whose `name` already exists via `ON CONFLICT DO NOTHING`.
 */
export async function seedPlans(
  items: Array<{
    name: string;
    price_monthly: string;
    price_yearly: string;
    is_active?: boolean;
  }> = DEFAULT_PLANS,
) {
  const inserted = [];
  for (const plan of items) {
    const [row] = await getRequestDatabase()
      .insert(plans)
      .values({
        public_id: generatePublicId('plan'),
        name: plan.name,
        price_monthly: plan.price_monthly,
        price_yearly: plan.price_yearly,
        is_active: plan.is_active ?? true,
      })
      .onConflictDoNothing()
      .returning();
    if (row) inserted.push(row);
  }
  return inserted;
}
