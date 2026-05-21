import { and, eq, isNull } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { DEFAULT_REPOSITORY_LIST_LIMIT } from '@/shared/constants/query-limits.constants.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { WebhookCreateData, WebhookUpdateData } from './webhook.types.js';
import { webhookSubscribesToEvent } from './webhook-subscription.util.js';

export type WebhookRow = typeof webhooks.$inferSelect;

export class WebhookRepository {
  async listByOrganization(organization_id: number, limit = DEFAULT_REPOSITORY_LIST_LIMIT) {
    return getRequestDatabase()
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.organization_id, organization_id), isNull(webhooks.deleted_at)))
      .limit(limit);
  }

  async listEnabledSubscribedToEvent(
    organization_id: number,
    event_type: string,
    limit = DEFAULT_REPOSITORY_LIST_LIMIT,
  ) {
    const rows = await this.listByOrganization(organization_id, limit);
    return rows.filter((row) => row.is_enabled && webhookSubscribesToEvent(row.events, event_type));
  }

  async findByPublicId(public_id: string, organization_id: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.public_id, public_id),
          eq(webhooks.organization_id, organization_id),
          isNull(webhooks.deleted_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: WebhookCreateData) {
    const now = new Date();
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const rows = await getRequestDatabase()
        .insert(webhooks)
        .values({
          public_id,
          organization_id: data.organization_id,
          url: data.url,
          encrypted_secret: data.encrypted_secret,
          events: data.events as Record<string, unknown>,
          is_enabled: data.is_enabled ?? true,
          created_by_user_id: data.created_by_user_id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [webhooks.organization_id, webhooks.url],
          set: {
            deleted_at: null,
            encrypted_secret: data.encrypted_secret,
            events: data.events as Record<string, unknown>,
            is_enabled: data.is_enabled ?? true,
            updated_at: now,
            updated_by_user_id: data.created_by_user_id ?? undefined,
          },
        })
        .returning();
      return rows[0]!;
    });
  }

  async update(
    public_id: string,
    organization_id: number,
    data: WebhookUpdateData,
    updated_by_user_id?: number,
  ) {
    const rows = await getRequestDatabase()
      .update(webhooks)
      .set({
        ...data,
        events: data.events as Record<string, unknown> | undefined,
        updated_at: databaseNowTimestamp,
        updated_by_user_id: updated_by_user_id ?? undefined,
      })
      .where(
        and(
          eq(webhooks.public_id, public_id),
          eq(webhooks.organization_id, organization_id),
          isNull(webhooks.deleted_at),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(public_id: string, organization_id: number) {
    const rows = await getRequestDatabase()
      .update(webhooks)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(webhooks.public_id, public_id),
          eq(webhooks.organization_id, organization_id),
          isNull(webhooks.deleted_at),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
