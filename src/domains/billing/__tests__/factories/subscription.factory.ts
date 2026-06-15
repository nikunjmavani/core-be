import { database } from '@/infrastructure/database/connection.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

export interface CreateTestSubscriptionOptions {
  organizationId: number;
  planId: number;
  status?: string;
  billingCycle?: string;
  /**
   * Provider name. Pass `null` for a local-only (non-Stripe) subscription. When
   * omitted, defaults to `'stripe'`.
   */
  provider?: string | null;
  /**
   * Provider subscription id. Pass `null` for a local-only subscription so the
   * service skips the external Stripe network call (cancel/resume/change-plan
   * mutate the row directly and return 200). When omitted, defaults to a synthetic
   * `sub_test_*` id, which makes the fail-closed service attempt a Stripe call.
   */
  providerSubscriptionId?: string | null;
  createdByUserId?: number;
}

/**
 * Insert a subscription row for tests.
 *
 * @remarks
 * - **Stripe-backed (default):** with a `provider_subscription_id` present, the
 *   subscription service performs an external Stripe call on cancel/resume/
 *   change-plan and is fail-closed — it surfaces `ServiceUnavailableError` (503)
 *   when Stripe is unconfigured or unreachable (the case in CI and local test
 *   runs). Use this to exercise the fail-closed negative path.
 * - **Local-only:** pass `providerSubscriptionId: null` (and optionally
 *   `provider: null`) to skip the Stripe call entirely so mutation endpoints
 *   exercise the database transition logic and return 200 deterministically.
 */
export async function createTestSubscription(options: CreateTestSubscriptionOptions) {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const provider = options.provider !== undefined ? options.provider : 'stripe';
  const providerSubscriptionId =
    options.providerSubscriptionId !== undefined
      ? options.providerSubscriptionId
      : `sub_test_${generatePublicId('subscription')}`;

  const [subscription] = await database
    .insert(subscriptions)
    .values({
      public_id: generatePublicId('subscription'),
      organization_id: options.organizationId,
      plan_id: options.planId,
      billing_cycle: options.billingCycle ?? 'MONTHLY',
      status: options.status ?? 'ACTIVE',
      provider,
      provider_subscription_id: providerSubscriptionId,
      current_period_start: now,
      current_period_end: periodEnd,
      created_by_user_id: options.createdByUserId,
    })
    .returning();

  return subscription!;
}
