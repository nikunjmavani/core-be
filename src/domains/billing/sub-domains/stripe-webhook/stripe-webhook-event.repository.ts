import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import {
  assertWorkerDatabaseContext,
  isWorkerRuntime,
} from '@/infrastructure/database/contexts/worker-database.context.js';
import {
  MILLISECONDS_PER_MINUTE,
  STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES,
} from '@/shared/constants/index.js';
import {
  stripe_webhook_events,
  type StripeWebhookProcessingStatus,
} from './stripe-webhook.schema.js';

/**
 * Outcome of {@link StripeWebhookEventRepository.tryClaimEvent}: `claimed` for a
 * brand-new event, `processed_duplicate` for an at-least-once redelivery,
 * `reclaimed` when a previously failed or stuck-processing row was retried, and
 * `still_processing_within_lease` when another worker is actively processing the
 * event and the caller must back off.
 */
export type StripeWebhookEventClaimResult =
  | 'claimed'
  | 'processed_duplicate'
  | 'reclaimed'
  | 'still_processing_within_lease';

function stripeWebhookLedgerDatabase() {
  if (isWorkerRuntime()) {
    assertWorkerDatabaseContext(['system_table']);
  }
  return getRequestDatabase();
}

/**
 * Append-mostly ledger access for the `billing.stripe_webhook_events` system
 * table that backs at-least-once Stripe delivery idempotency.
 *
 * @remarks
 * - **Algorithm:** {@link tryClaimEvent} attempts an `INSERT ... ON CONFLICT DO
 *   NOTHING` to atomically reserve the event id, falling back to a status read
 *   that classifies duplicates, stuck-processing leases, and reclaim windows.
 *   {@link tryReclaimEvent} flips a `failed` or stale-`processing` row back to
 *   `processing` (incrementing `attempt_count`) so the worker can retry safely.
 * - **Failure modes:** Returning `still_processing_within_lease` signals the
 *   caller to defer; the in-process service raises `ConflictError` on that
 *   outcome. `markFailed` truncates failure reasons to 2,000 characters.
 * - **Side effects:** All writes happen on a worker-context handle when running
 *   under {@link isWorkerRuntime}; otherwise on the request-scoped database.
 *   Reclaim sweeps touch up to `batchSize` rows per invocation.
 * - **Notes:** The ledger row is the source of truth for delivery state and is
 *   intentionally separate from any business-side subscription mutations.
 */
export class StripeWebhookEventRepository {
  async tryClaimEvent(input: {
    stripe_event_id: string;
    event_type: string;
    stripe_created_at: Date;
    request_id?: string;
  }): Promise<StripeWebhookEventClaimResult> {
    const insertedRows = await stripeWebhookLedgerDatabase()
      .insert(stripe_webhook_events)
      .values({
        stripe_event_id: input.stripe_event_id,
        event_type: input.event_type,
        stripe_created_at: input.stripe_created_at,
        processing_status: 'processing',
        request_id: input.request_id,
        attempt_count: 0,
      })
      .onConflictDoNothing()
      .returning({ stripe_event_id: stripe_webhook_events.stripe_event_id });

    if (insertedRows.length > 0) {
      return 'claimed';
    }

    const existingRows = await stripeWebhookLedgerDatabase()
      .select({
        processing_status: stripe_webhook_events.processing_status,
      })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.stripe_event_id, input.stripe_event_id))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      return 'still_processing_within_lease';
    }

    if (existing.processing_status === 'processed') {
      return 'processed_duplicate';
    }

    const reclaimed = await this.tryReclaimEvent(input.stripe_event_id);
    if (reclaimed) {
      return 'reclaimed';
    }

    return 'still_processing_within_lease';
  }

  /**
   * Re-claim a failed or stuck-processing ledger row for retry.
   *
   * @remarks
   * Three reclaim conditions are recognised:
   *   1. status='failed' — a prior worker attempt threw; safe to retry.
   *   2. status='processing' AND updated_at older than the stuck-lease window — a
   *      worker that was processing this row has likely crashed or stalled; safe
   *      to retry (the previous worker's writes will fail-on-RETURNING once it
   *      revives).
   *   3. status='processing' AND attempt_count=0 — sec-B finding #6: the HTTP
   *      ingress committed the durability row but the worker is the first to
   *      actually dispatch. Atomicity of the UPDATE (which bumps attempt_count
   *      to 1) guarantees only one worker can win this transition; a concurrent
   *      retry that arrived seconds later will see attempt_count=1 and
   *      updated_at fresh, neither matches, and gets `still_processing_within_lease`.
   */
  async tryReclaimEvent(stripe_event_id: string): Promise<boolean> {
    const stuckProcessingBefore = new Date(
      Date.now() - STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES * MILLISECONDS_PER_MINUTE,
    );

    const rows = await stripeWebhookLedgerDatabase()
      .update(stripe_webhook_events)
      .set({
        processing_status: 'processing' satisfies StripeWebhookProcessingStatus,
        attempt_count: sql`${stripe_webhook_events.attempt_count} + 1`,
        updated_at: sql`NOW()`,
        failure_reason: null,
        processed_at: null,
      })
      .where(
        and(
          eq(stripe_webhook_events.stripe_event_id, stripe_event_id),
          or(
            eq(stripe_webhook_events.processing_status, 'failed'),
            and(
              eq(stripe_webhook_events.processing_status, 'processing'),
              lt(stripe_webhook_events.updated_at, stuckProcessingBefore),
            ),
            and(
              eq(stripe_webhook_events.processing_status, 'processing'),
              eq(stripe_webhook_events.attempt_count, 0),
            ),
          ),
        ),
      )
      .returning({ stripe_event_id: stripe_webhook_events.stripe_event_id });

    return rows.length > 0;
  }

  async markProcessed(stripe_event_id: string): Promise<boolean> {
    // sec-new-D2: return whether a row was actually updated so the caller can
    // detect and log a no-op (e.g. the ledger row was unexpectedly absent).
    const rows = await stripeWebhookLedgerDatabase()
      .update(stripe_webhook_events)
      .set({
        processing_status: 'processed' satisfies StripeWebhookProcessingStatus,
        processed_at: new Date(),
        updated_at: sql`NOW()`,
      })
      .where(eq(stripe_webhook_events.stripe_event_id, stripe_event_id))
      .returning({ stripe_event_id: stripe_webhook_events.stripe_event_id });
    return rows.length > 0;
  }

  async countFailedEvents(): Promise<number> {
    const rows = await stripeWebhookLedgerDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.processing_status, 'failed'));
    return rows[0]?.count ?? 0;
  }

  async findReclaimableStripeEventIds(limit: number): Promise<string[]> {
    const stuckProcessingBefore = new Date(
      Date.now() - STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES * MILLISECONDS_PER_MINUTE,
    );

    const rows = await stripeWebhookLedgerDatabase()
      .select({ stripe_event_id: stripe_webhook_events.stripe_event_id })
      .from(stripe_webhook_events)
      .where(
        or(
          eq(stripe_webhook_events.processing_status, 'failed'),
          and(
            eq(stripe_webhook_events.processing_status, 'processing'),
            lt(stripe_webhook_events.updated_at, stuckProcessingBefore),
          ),
        ),
      )
      .orderBy(asc(stripe_webhook_events.updated_at))
      .limit(limit);

    return rows.map((row) => row.stripe_event_id);
  }

  /**
   * Scans the ledger for reclaimable rows (failed, or processing past the
   * stuck-lease window) and returns their stripe_event_ids without mutating
   * the rows.
   *
   * @remarks
   * - **sec-re-02:** Prior to this fix, the sweep called
   *   {@link tryReclaimEvent} inline, which bumped `processing_status` to
   *   `processing`, incremented `attempt_count` and refreshed `updated_at`.
   *   The worker's subsequent `tryClaimEvent` → `tryReclaimEvent` then found
   *   all three reclaim branches false (not failed, not stale, not
   *   attempt_count = 0), returned `still_processing_within_lease`, BullMQ
   *   retried 5× and DLQ'd, and — combined with sec-Q #1's seven-day
   *   failed-job retention — the next sweep's re-enqueue became a silent
   *   duplicate-jobId no-op. The row was stuck in `processing` permanently.
   *   Returning just the candidate ids and letting the worker call
   *   `tryClaimEvent` → `tryReclaimEvent` itself preserves the atomic
   *   transition semantics in one place (the worker) and re-arms the
   *   failed → processing branch.
   * - **Failure modes:** none beyond a transient SELECT error, which the
   *   caller logs and retries on the next sweep.
   * - **Side effects:** none — pure read.
   * - **Notes:** the cron processor pairs this with
   *   `enqueueStripeWebhookByEventIdForReclaim` (fresh jobId per attempt) so
   *   the BullMQ dedup does not block the re-enqueue.
   */
  async sweepReclaimableEvents(batchSize: number): Promise<{
    scannedCount: number;
    candidateStripeEventIds: string[];
  }> {
    const candidateStripeEventIds = await this.findReclaimableStripeEventIds(batchSize);
    return {
      scannedCount: candidateStripeEventIds.length,
      candidateStripeEventIds,
    };
  }

  async markFailed(stripe_event_id: string, failure_reason: string): Promise<boolean> {
    // sec-new-D2: return whether a row was actually updated so the caller can
    // detect and log a no-op (e.g. the ledger row was unexpectedly absent).
    const truncatedReason =
      failure_reason.length > 2000 ? failure_reason.slice(0, 2000) : failure_reason;
    const rows = await stripeWebhookLedgerDatabase()
      .update(stripe_webhook_events)
      .set({
        processing_status: 'failed' satisfies StripeWebhookProcessingStatus,
        processed_at: new Date(),
        failure_reason: truncatedReason,
        updated_at: sql`NOW()`,
      })
      .where(eq(stripe_webhook_events.stripe_event_id, stripe_event_id))
      .returning({ stripe_event_id: stripe_webhook_events.stripe_event_id });
    return rows.length > 0;
  }
}
