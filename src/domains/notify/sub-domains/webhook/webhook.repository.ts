import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { DEFAULT_REPOSITORY_LIST_LIMIT } from '@/shared/constants/query-limits.constants.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { WebhookCreateData, WebhookUpdateData } from './webhook.types.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';

/**
 * `updated_at` value for webhook mutations: `greatest(created_at, now())` rather than bare `now()`.
 *
 * Postgres `now()` is the TRANSACTION start time. Under heavy parallel test load a mutation's
 * transaction can begin before a webhook row that was created in a later-started transaction which
 * committed first, making `now() < created_at` and violating the `chk_webhooks_updated`
 * (`updated_at >= created_at`) CHECK on soft-delete/update. `greatest` keeps the invariant — and
 * "updated_at never precedes created_at" — true regardless of transaction-start timing.
 */
const webhookUpdatedAtTimestamp: SQL = sql`greatest(${webhooks.created_at}, now())`;

/** Drizzle row type inferred from the `notify.webhooks` table. */
export type WebhookRow = typeof webhooks.$inferSelect;

/** Keyset pagination input for {@link WebhookRepository.listByOrganization}. */
export interface WebhookListPagination {
  after?: string;
  limit: number;
  include_total?: boolean;
}

/**
 * Drizzle-backed access to `notify.webhooks` — owns the SQL for the dashboard list (ascending
 * keyset by `(created_at, id)` with optional total), single-webhook reads, and the
 * upsert/soft-delete lifecycle. Insert uses an `ON CONFLICT (organization_id, url) DO UPDATE`
 * to revive a soft-deleted row when the same URL is re-added; `softDelete` stamps `deleted_at`
 * so the tombstone-retention worker can later hard-delete rows.
 */
export class WebhookRepository {
  async listByOrganization(organization_id: number, pagination: WebhookListPagination) {
    const { after, limit } = pagination;
    const includeTotal = pagination.include_total === true;
    const filterConditions: SQL[] = [
      eq(webhooks.organization_id, organization_id),
      isNull(webhooks.deleted_at),
    ];
    const countWhere = and(...filterConditions);
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      webhooks.created_at,
      webhooks.id,
      parseListCursor(after),
    );
    const where =
      cursorCondition !== undefined ? and(...filterConditions, cursorCondition) : countWhere;

    const rowsPromise = getRequestDatabase()
      .select()
      .from(webhooks)
      .where(where)
      .orderBy(asc(webhooks.created_at), asc(webhooks.id))
      .limit(limit + 1);

    const countPromise = includeTotal
      ? getRequestDatabase()
          .select({ count: count() })
          .from(webhooks)
          .where(countWhere)
          .then((rows) => rows[0]?.count ?? 0)
      : Promise.resolve(null);

    const [fetchedRows, total] = await Promise.all([rowsPromise, countPromise]);
    const hasMore = fetchedRows.length > limit;
    const items = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const lastItem = items.at(-1);
    return {
      items,
      total,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  /**
   * Count active (non-deleted) webhooks for an organization. Used by the
   * service-layer per-organization cap (sec-N4) so a single tenant cannot
   * register an unbounded subscriber list within their rate-limit budget.
   * Returns a plain integer suitable for comparing against `WEBHOOK_MAX_PER_ORG`.
   */
  async countActiveByOrganization(organization_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .select({ count: count() })
      .from(webhooks)
      .where(and(eq(webhooks.organization_id, organization_id), isNull(webhooks.deleted_at)));
    return Number(rows[0]?.count ?? 0);
  }

  async listEnabledSubscribedToEvent(
    organization_id: number,
    event_type: string,
    page_size = DEFAULT_REPOSITORY_LIST_LIMIT,
    maxRows?: number,
  ): Promise<WebhookRow[]> {
    const subscribedEventFilter = sql`${webhooks.events} @> ${JSON.stringify([event_type])}::jsonb`;
    const filterConditions: SQL[] = [
      eq(webhooks.organization_id, organization_id),
      eq(webhooks.is_enabled, true),
      subscribedEventFilter,
      isNull(webhooks.deleted_at),
    ];
    const allRows: WebhookRow[] = [];
    let after: string | undefined;

    while (true) {
      const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
        webhooks.created_at,
        webhooks.id,
        parseListCursor(after),
      );
      const where =
        cursorCondition !== undefined
          ? and(...filterConditions, cursorCondition)
          : and(...filterConditions);

      const fetchedRows = await getRequestDatabase()
        .select()
        .from(webhooks)
        .where(where)
        .orderBy(asc(webhooks.created_at), asc(webhooks.id))
        .limit(page_size + 1);

      const hasMore = fetchedRows.length > page_size;
      const pageItems = hasMore ? fetchedRows.slice(0, page_size) : fetchedRows;
      allRows.push(...pageItems);

      if (!hasMore) {
        break;
      }

      // sec-N4: defense-in-depth fan-out cap. The service-level create cap
      // already prevents legitimate orgs from registering more than
      // `WEBHOOK_MAX_PER_ORG` rows, so reaching this branch means either
      // abuse or the two caps have drifted — caller decides which.
      if (maxRows !== undefined && allRows.length >= maxRows) {
        return allRows.slice(0, maxRows);
      }

      const lastItem = pageItems.at(-1);
      if (lastItem === undefined) {
        break;
      }
      after = createOpaqueCursorFromRow(lastItem);
    }

    return allRows;
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
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId('webhook');
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
            // route-audit C3: greatest(created_at, now()) — the revived row's created_at is the
            // original DB-clock value; a bare JS `new Date()` here could be < created_at under
            // host/DB clock skew and violate chk_webhooks_updated. Reuses the same expression as
            // update()/softDelete().
            updated_at: webhookUpdatedAtTimestamp,
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
    // sec-N8: when the encrypted_secret is being rotated, atomically copy the
    // CURRENT value into encrypted_secret_previous and stamp secret_rotated_at.
    // We use a SQL expression for `previous` so the previous-value read happens
    // inside the same UPDATE statement (no read-modify-write race).
    const rotatingSecret = data.encrypted_secret !== undefined;
    const baseSet: Record<string, unknown> = {
      ...data,
      events: data.events as Record<string, unknown> | undefined,
      updated_at: webhookUpdatedAtTimestamp,
      updated_by_user_id: updated_by_user_id ?? undefined,
    };
    if (rotatingSecret) {
      baseSet.encrypted_secret_previous = sql`${webhooks.encrypted_secret}`;
      baseSet.secret_rotated_at = databaseNowTimestamp;
    }
    const rows = await getRequestDatabase()
      .update(webhooks)
      .set(baseSet)
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
      .set({ deleted_at: databaseNowTimestamp, updated_at: webhookUpdatedAtTimestamp })
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
