import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { listDeadLetterQueueNames } from '@/infrastructure/queue/dlq/dead-letter.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { AUDIT_EXPORT_QUEUE_NAME } from '@/domains/audit/workers/audit-export.constants.js';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import { MAIL_OUTBOX_SWEEPER_QUEUE_NAME } from '@/infrastructure/mail/workers/mail-outbox-sweeper.constants.js';
import { NOTIFICATION_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/workers/notification-retention.constants.js';
import { STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.constants.js';
import { STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.constants.js';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';
import { WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/workers/webhook-tombstone-retention.constants.js';
import { WEBHOOK_DELIVERY_ATTEMPT_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/workers/webhook-delivery-attempt-retention.constants.js';
import { USER_DATA_EXPORT_RETENTION_QUEUE_NAME } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.constants.js';
import { UPLOAD_PENDING_SWEEP_QUEUE_NAME } from '@/domains/upload/workers/upload-pending-sweep.constants.js';
import { AUDIT_OUTBOX_DRAIN_QUEUE_NAME } from '@/domains/audit/workers/audit-outbox-drain.constants.js';
import { ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.constants.js';
import { USER_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/user/workers/user-tombstone-retention.constants.js';
import { ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/workers/organization-tombstone-retention.constants.js';
import { MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/membership/workers/membership-tombstone-retention.constants.js';
import { MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.constants.js';
import { ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-api-key/workers/organization-api-key-tombstone-retention.constants.js';
import { UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/upload/workers/upload-tombstone-retention.constants.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { IDEMPOTENCY_CARDINALITY_QUEUE_NAME } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.constants.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Source queues whose `<queue>-dlq` depth is sampled each pass (reaudit-#5).
 *
 * @remarks
 * - **Algorithm:** {@link sampleDeadLetterQueueDepths} iterates this list and reads
 *   `<queue>-dlq` waiting+failed counts, warning/Sentry-ing past the threshold.
 * - **Failure modes:** a queue omitted here is never sampled, so a stuck cleanup
 *   dead-letters silently.
 * - **Side effects:** none (declaration only).
 * - **Notes:** every `family: 'retention'` worker MUST appear here — enforced by
 *   `dlq-depth.coverage.unit.test.ts`, which fails on any omission so the list cannot drift.
 */
export const SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING = [
  MAIL_QUEUE_NAME,
  MAIL_OUTBOX_SWEEPER_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_RETENTION_QUEUE_NAME,
  AUDIT_EXPORT_QUEUE_NAME,
  AUDIT_RETENTION_QUEUE_NAME,
  AUDIT_OUTBOX_DRAIN_QUEUE_NAME,
  STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME,
  STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME,
  SESSION_CLEANUP_QUEUE_NAME,
  WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME,
  // reaudit-#5: retention workers that were missing from monitoring.
  WEBHOOK_DELIVERY_ATTEMPT_RETENTION_QUEUE_NAME,
  USER_DATA_EXPORT_RETENTION_QUEUE_NAME,
  UPLOAD_PENDING_SWEEP_QUEUE_NAME,
  ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME,
  USER_TOMBSTONE_RETENTION_QUEUE_NAME,
  ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME,
  MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME,
  MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME,
  ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME,
  UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME,
  STRIPE_WEBHOOK_QUEUE_NAME,
  IDEMPOTENCY_CARDINALITY_QUEUE_NAME,
] as const;

/**
 * One-pass dead-letter queue depth snapshot returned by
 * {@link sampleDeadLetterQueueDepths} — `waiting + failed` counts per DLQ.
 *
 * @remarks
 * - **Algorithm:** the inner `depths` array preserves the order of
 *   `SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING` so consumers can join by index.
 * - **Failure modes:** queues that fail to connect raise inside the sampler and
 *   abort the call; partial results are not returned.
 * - **Side effects:** none from the type itself.
 * - **Notes:** consumed by the DLQ depth worker and `getTotalDeadLetterJobCount`.
 */
export interface DlqDepthSampleResult {
  readonly depths: ReadonlyArray<{
    readonly deadLetterQueueName: string;
    readonly waiting: number;
    readonly failed: number;
    readonly total: number;
  }>;
}

/**
 * Samples waiting + failed counts on every per-source DLQ and raises a Sentry
 * warning whenever a single queue crosses `DLQ_DEPTH_WARN_THRESHOLD`.
 *
 * @remarks
 * - **Algorithm:** iterates `SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING`, opens a
 *   short-lived `Queue` against each `<source>-dlq` name, reads
 *   `getJobCounts('waiting','failed')`, and aggregates totals.
 * - **Failure modes:** Redis connectivity errors during `getJobCounts` propagate
 *   to the worker; queue clients are closed in `finally` to release sockets.
 * - **Side effects:** Sentry `captureMessage('queue.dlq.depth.high', ...)` and
 *   structured log when `total >= warnThreshold`; transient Redis client open/close.
 * - **Notes:** driven by `createDlqDepthWorker`'s repeatable schedule; safe to
 *   call ad hoc for one-shot health probing.
 */
export async function sampleDeadLetterQueueDepths(): Promise<DlqDepthSampleResult> {
  const warnThreshold = env.DLQ_DEPTH_WARN_THRESHOLD;
  const deadLetterQueueNames = listDeadLetterQueueNames(SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING);
  const depths: DlqDepthSampleResult['depths'][number][] = [];

  for (const deadLetterQueueName of deadLetterQueueNames) {
    const queue = new Queue(deadLetterQueueName, {
      connection: getBullMQConnectionOptions(),
    });

    try {
      const counts = await queue.getJobCounts('waiting', 'failed');
      const waiting = counts.waiting ?? 0;
      const failed = counts.failed ?? 0;
      const total = waiting + failed;

      depths.push({ deadLetterQueueName, waiting, failed, total });

      if (total >= warnThreshold) {
        logger.warn(
          { deadLetterQueueName, waiting, failed, total, warnThreshold },
          'queue.dlq.depth.high',
        );
        captureMessage('queue.dlq.depth.high', {
          level: 'warning',
          extra: { deadLetterQueueName, waiting, failed, total, warnThreshold },
        });
      }
    } finally {
      await queue.close();
    }
  }

  return { depths };
}

/**
 * Convenience aggregator that returns the cluster-wide DLQ backlog.
 *
 * @remarks
 * - **Algorithm:** runs {@link sampleDeadLetterQueueDepths} and sums each entry's
 *   `total` (waiting + failed).
 * - **Failure modes:** propagates any error from the sampler.
 * - **Side effects:** same as the sampler — Sentry alerts may fire as a side
 *   effect of reading per-queue counts.
 * - **Notes:** used by health-check probes that just need a single scalar.
 */
export async function getTotalDeadLetterJobCount(): Promise<number> {
  const sample = await sampleDeadLetterQueueDepths();
  return sample.depths.reduce((total, entry) => total + entry.total, 0);
}
