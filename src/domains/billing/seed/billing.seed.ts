/**
 * Billing domain demo seed — subscriptions.
 * Orchestration calls these from scripts/seed/full.ts.
 */
import { desc, eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';

/**
 * Input for {@link seedSubscription} / {@link findOrSeedSubscription}; identifiers
 * are internal numeric IDs because the seed runs inside the orchestration script.
 */
export interface SeedSubscriptionPayload {
  organization_id: number;
  plan_id: number;
  created_by_user_id: number;
  status?: string;
}

/**
 * Inserts a fake monthly Stripe subscription row for demo data, defaulting to
 * `ACTIVE` and a one-month current period starting at insert time.
 */
export async function seedSubscription(payload: SeedSubscriptionPayload) {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const [row] = await getRequestDatabase()
    .insert(subscriptions)
    .values({
      public_id: generatePublicId('subscription'),
      organization_id: payload.organization_id,
      plan_id: payload.plan_id,
      billing_cycle: 'MONTHLY',
      status: payload.status ?? 'ACTIVE',
      provider: 'stripe',
      provider_subscription_id: `sub_seed_${generatePublicId('subscription')}`,
      current_period_start: now,
      current_period_end: periodEnd,
      created_by_user_id: payload.created_by_user_id,
    })
    .returning();
  return row ?? null;
}

/**
 * Returns the most recent subscription for the organization or, if none exists,
 * seeds one via {@link seedSubscription} — used by the orchestration script to
 * keep `pnpm db:seed:full` idempotent.
 */
export async function findOrSeedSubscription(payload: SeedSubscriptionPayload) {
  const database = getRequestDatabase();
  const [existing] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organization_id, payload.organization_id))
    .orderBy(desc(subscriptions.created_at))
    .limit(1);

  if (existing) {
    return existing;
  }

  const created = await seedSubscription(payload);
  if (!created) throw new Error('findOrSeedSubscription: failed to create subscription');
  return created;
}
