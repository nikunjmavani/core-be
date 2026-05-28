import { and, count, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { assertWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import {
  webhooks,
  webhook_delivery_attempts,
} from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { WEBHOOK_DELIVERY_STUCK_SENDING_LEASE_MINUTES } from '@/domains/notify/sub-domains/webhook/webhook-delivery.constants.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/ttl.constants.js';
import {
  buildDescendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';

/**
 * Outcome of {@link WebhookDeliveryAttemptRepository.tryMarkSending}. `claimed` means the
 * worker now owns the attempt; `in_flight` means another worker still holds a fresh lease;
 * `already_sent` means a previous attempt succeeded and the worker should no-op.
 */
export type WebhookDeliverySendingClaimResult = 'claimed' | 'in_flight' | 'already_sent';

/** Keyset pagination input for listing delivery attempts in the dashboard. */
export interface WebhookDeliveryAttemptListPagination {
  after?: string;
  limit: number;
  include_total?: boolean;
}

/**
 * Drizzle-backed access to `notify.webhook_delivery_attempts` — the immutable audit trail of
 * outbound webhook deliveries. Owns the SQL for the dashboard list, the at-most-one-in-flight
 * `PENDING → SENDING` transition with stale-lease reclaim, the terminal outcome write, and
 * inserts for both real and test deliveries. Resolves its database handle via the shared
 * request/worker context helper so it works under HTTP RLS and worker organization scopes.
 */
export class WebhookDeliveryAttemptRepository {
  constructor(private readonly databaseHandle?: RequestScopedPostgresDatabase) {}

  private db(): RequestScopedPostgresDatabase {
    return resolveRepositoryDatabaseHandle(this.databaseHandle);
  }

  async listByWebhook(webhook_id: number, pagination: WebhookDeliveryAttemptListPagination) {
    const { after, limit } = pagination;
    const includeTotal = pagination.include_total === true;
    const filterConditions: SQL[] = [eq(webhook_delivery_attempts.webhook_id, webhook_id)];
    const countWhere = and(...filterConditions);
    const cursorCondition = buildDescendingCreatedAtIdCursorCondition(
      webhook_delivery_attempts.created_at,
      webhook_delivery_attempts.id,
      parseListCursor(after),
    );
    const where =
      cursorCondition !== undefined ? and(...filterConditions, cursorCondition) : countWhere;

    const rowsPromise = this.db()
      .select()
      .from(webhook_delivery_attempts)
      .where(where)
      .orderBy(desc(webhook_delivery_attempts.created_at), desc(webhook_delivery_attempts.id))
      .limit(limit + 1);

    const countPromise = includeTotal
      ? this.db()
          .select({ count: count() })
          .from(webhook_delivery_attempts)
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

  /** Resolve webhook public_id + organization_id to internal webhook_id for auth */
  async getWebhookId(webhook_public_id: string, organization_id: number): Promise<number | null> {
    const rows = await this.db()
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.public_id, webhook_public_id),
          eq(webhooks.organization_id, organization_id),
          isNull(webhooks.deleted_at),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * Atomically claims a delivery attempt for outbound HTTP (`PENDING` → `SENDING`, or
   * reclaims a stale `SENDING` row after the lease expires).
   */
  async tryMarkSending(
    deliveryAttemptId: number,
    attemptCount: number,
  ): Promise<WebhookDeliverySendingClaimResult> {
    const staleSendingBefore = new Date(
      Date.now() - WEBHOOK_DELIVERY_STUCK_SENDING_LEASE_MINUTES * MILLISECONDS_PER_MINUTE,
    );
    const requestDatabase = this.db();

    const claimedFromPending = await requestDatabase
      .update(webhook_delivery_attempts)
      .set({
        status: 'SENDING',
        attempt_count: attemptCount,
        sent_at: new Date(),
      })
      .where(
        and(
          eq(webhook_delivery_attempts.id, deliveryAttemptId),
          eq(webhook_delivery_attempts.status, 'PENDING'),
        ),
      )
      .returning({ id: webhook_delivery_attempts.id });

    if (claimedFromPending.length > 0) {
      return 'claimed';
    }

    const reclaimedStaleSending = await requestDatabase
      .update(webhook_delivery_attempts)
      .set({
        status: 'SENDING',
        attempt_count: attemptCount,
        sent_at: new Date(),
      })
      .where(
        and(
          eq(webhook_delivery_attempts.id, deliveryAttemptId),
          eq(webhook_delivery_attempts.status, 'SENDING'),
          lt(webhook_delivery_attempts.sent_at, staleSendingBefore),
        ),
      )
      .returning({ id: webhook_delivery_attempts.id });

    if (reclaimedStaleSending.length > 0) {
      return 'claimed';
    }

    const statusRows = await requestDatabase
      .select({ status: webhook_delivery_attempts.status })
      .from(webhook_delivery_attempts)
      .where(eq(webhook_delivery_attempts.id, deliveryAttemptId))
      .limit(1);

    if (statusRows[0]?.status === 'SENT') {
      return 'already_sent';
    }

    return 'in_flight';
  }

  /**
   * Persist terminal or in-progress delivery outcome (used by webhook-delivery worker).
   */
  async recordOutcome(
    deliveryAttemptId: number,
    outcome: {
      status: string;
      http_status_code?: number | null;
      response_body?: string | null;
      next_retry_at?: Date | null;
    },
  ): Promise<void> {
    await this.db()
      .update(webhook_delivery_attempts)
      .set({
        status: outcome.status,
        http_status_code: outcome.http_status_code ?? null,
        response_body: outcome.response_body ?? null,
        next_retry_at: outcome.next_retry_at ?? null,
      })
      .where(eq(webhook_delivery_attempts.id, deliveryAttemptId));
  }

  /** Record a delivery attempt (used for both real events and test deliveries). */
  async create(data: {
    webhook_id: number;
    event_type: string;
    payload: unknown;
    status: string;
    http_status_code: number | null;
    response_body: string | null;
    sent_at: Date | null;
    attempt_count: number;
  }) {
    const rows = await this.db()
      .insert(webhook_delivery_attempts)
      .values({
        webhook_id: data.webhook_id,
        event_type: data.event_type,
        payload: data.payload,
        status: data.status,
        http_status_code: data.http_status_code,
        response_body: data.response_body,
        sent_at: data.sent_at,
        attempt_count: data.attempt_count,
      })
      .returning();
    return rows[0]!;
  }
}

/** Worker-only factory — requires an explicit handle from `withOrganizationContext`. */
export function createWorkerWebhookDeliveryAttemptRepository(
  databaseHandle: RequestScopedPostgresDatabase,
): WebhookDeliveryAttemptRepository {
  assertWorkerDatabaseContext(['organization']);
  return new WebhookDeliveryAttemptRepository(databaseHandle);
}
