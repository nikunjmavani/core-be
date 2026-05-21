import { database } from '@/infrastructure/database/connection.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

export interface CreateTestSubscriptionOptions {
  organizationId: number;
  planId: number;
  status?: string;
  billingCycle?: string;
  providerSubscriptionId?: string;
  createdByUserId?: number;
}

export async function createTestSubscription(options: CreateTestSubscriptionOptions) {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const [subscription] = await database
    .insert(subscriptions)
    .values({
      public_id: generatePublicId(),
      organization_id: options.organizationId,
      plan_id: options.planId,
      billing_cycle: options.billingCycle ?? 'MONTHLY',
      status: options.status ?? 'ACTIVE',
      provider: 'stripe',
      provider_subscription_id: options.providerSubscriptionId ?? `sub_test_${generatePublicId()}`,
      current_period_start: now,
      current_period_end: periodEnd,
      created_by_user_id: options.createdByUserId,
    })
    .returning();

  return subscription!;
}
