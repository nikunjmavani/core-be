import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { assertWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database-context.js';
import { DEFAULT_REPOSITORY_LIST_LIMIT } from '@/shared/constants/query-limits.constants.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { SubscriptionCreateData, SubscriptionUpdateData } from './subscription.types.js';

export class SubscriptionRepository {
  constructor(private readonly databaseHandle?: RequestScopedPostgresDatabase) {}

  private db(): RequestScopedPostgresDatabase {
    return resolveRepositoryDatabaseHandle(this.databaseHandle);
  }

  async listByOrganization(organization_id: number, limit = DEFAULT_REPOSITORY_LIST_LIMIT) {
    return this.db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organization_id, organization_id))
      .limit(limit);
  }

  async findByPublicId(public_id: string, organization_id: number) {
    const rows = await this.db()
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.public_id, public_id),
          eq(subscriptions.organization_id, organization_id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: SubscriptionCreateData) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const rows = await this.db()
        .insert(subscriptions)
        .values({
          public_id,
          organization_id: data.organization_id,
          plan_id: data.plan_id,
          billing_cycle: data.billing_cycle,
          status: data.status ?? 'TRIALING',
          current_period_start: data.current_period_start,
          current_period_end: data.current_period_end,
          trial_end: data.trial_end,
          provider: data.provider,
          provider_subscription_id: data.provider_subscription_id,
          provider_customer_id: data.provider_customer_id,
          created_by_user_id: data.created_by_user_id,
        })
        .returning();
      return rows[0]!;
    });
  }

  async update(public_id: string, organization_id: number, data: SubscriptionUpdateData) {
    const rows = await this.db()
      .update(subscriptions)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
      })
      .where(
        and(
          eq(subscriptions.public_id, public_id),
          eq(subscriptions.organization_id, organization_id),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async syncFromStripeProviderSubscription(
    provider_subscription_id: string,
    data: SubscriptionUpdateData,
    stripe_event_created_at: Date,
  ) {
    const rows = await this.db()
      .update(subscriptions)
      .set({
        ...data,
        last_stripe_event_created_at: stripe_event_created_at,
        updated_at: databaseNowTimestamp,
      })
      .where(
        and(
          eq(subscriptions.provider_subscription_id, provider_subscription_id),
          or(
            isNull(subscriptions.last_stripe_event_created_at),
            lte(subscriptions.last_stripe_event_created_at, stripe_event_created_at),
          ),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async markCanceledByProviderSubscriptionId(
    provider_subscription_id: string,
    stripe_event_created_at: Date,
  ) {
    const rows = await this.db()
      .update(subscriptions)
      .set({
        status: 'CANCELED',
        canceled_at: new Date(),
        last_stripe_event_created_at: stripe_event_created_at,
        updated_at: databaseNowTimestamp,
      })
      .where(
        and(
          eq(subscriptions.provider_subscription_id, provider_subscription_id),
          or(
            isNull(subscriptions.last_stripe_event_created_at),
            lte(subscriptions.last_stripe_event_created_at, stripe_event_created_at),
          ),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}

/** Worker-only factory — requires an explicit handle from `withOrganizationContext`. */
export function createWorkerSubscriptionRepository(
  databaseHandle: RequestScopedPostgresDatabase,
): SubscriptionRepository {
  assertWorkerDatabaseContext(['organization']);
  return new SubscriptionRepository(databaseHandle);
}
