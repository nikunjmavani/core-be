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
          ),
        ),
      )
      .returning({ stripe_event_id: stripe_webhook_events.stripe_event_id });

    return rows.length > 0;
  }

  async markProcessed(stripe_event_id: string): Promise<void> {
    await stripeWebhookLedgerDatabase()
      .update(stripe_webhook_events)
      .set({
        processing_status: 'processed' satisfies StripeWebhookProcessingStatus,
        processed_at: new Date(),
        updated_at: sql`NOW()`,
      })
      .where(eq(stripe_webhook_events.stripe_event_id, stripe_event_id));
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

  async sweepReclaimableEvents(batchSize: number): Promise<{
    scannedCount: number;
    reclaimedCount: number;
    reclaimedStripeEventIds: string[];
  }> {
    const candidateStripeEventIds = await this.findReclaimableStripeEventIds(batchSize);
    const reclaimedStripeEventIds: string[] = [];

    for (const stripeEventId of candidateStripeEventIds) {
      if (await this.tryReclaimEvent(stripeEventId)) {
        reclaimedStripeEventIds.push(stripeEventId);
      }
    }

    return {
      scannedCount: candidateStripeEventIds.length,
      reclaimedCount: reclaimedStripeEventIds.length,
      reclaimedStripeEventIds,
    };
  }

  async markFailed(stripe_event_id: string, failure_reason: string): Promise<void> {
    const truncatedReason =
      failure_reason.length > 2000 ? failure_reason.slice(0, 2000) : failure_reason;
    await stripeWebhookLedgerDatabase()
      .update(stripe_webhook_events)
      .set({
        processing_status: 'failed' satisfies StripeWebhookProcessingStatus,
        processed_at: new Date(),
        failure_reason: truncatedReason,
        updated_at: sql`NOW()`,
      })
      .where(eq(stripe_webhook_events.stripe_event_id, stripe_event_id));
  }
}
