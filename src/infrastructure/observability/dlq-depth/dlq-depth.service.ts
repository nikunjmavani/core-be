import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { listDeadLetterQueueNames } from '@/infrastructure/queue/dlq/dead-letter.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { AUDIT_EXPORT_QUEUE_NAME } from '@/domains/audit/workers/audit-export.constants.js';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import { MAIL_OUTBOX_SWEEPER_QUEUE_NAME } from '@/infrastructure/mail/workers/mail-outbox-sweeper.constants.js';
import { PARTITION_MAINTENANCE_QUEUE_NAME } from '@/infrastructure/queue/partition-maintenance/partition-maintenance.constants.js';
import { NOTIFICATION_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/workers/notification-retention.constants.js';
import { STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.constants.js';
import { STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.constants.js';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';
import { WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/workers/webhook-tombstone-retention.constants.js';
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

const SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING = [
  MAIL_QUEUE_NAME,
  MAIL_OUTBOX_SWEEPER_QUEUE_NAME,
  WEBHOOK_DELIVERY_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_RETENTION_QUEUE_NAME,
  AUDIT_EXPORT_QUEUE_NAME,
  AUDIT_RETENTION_QUEUE_NAME,
  PARTITION_MAINTENANCE_QUEUE_NAME,
  STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME,
  STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME,
  SESSION_CLEANUP_QUEUE_NAME,
  WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME,
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

export interface DlqDepthSampleResult {
  readonly depths: ReadonlyArray<{
    readonly deadLetterQueueName: string;
    readonly waiting: number;
    readonly failed: number;
    readonly total: number;
  }>;
}

/**
 * Samples waiting + failed job counts on each dead-letter queue and alerts when over threshold.
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

/** Sum of waiting + failed jobs across monitored dead-letter queues. */
export async function getTotalDeadLetterJobCount(): Promise<number> {
  const sample = await sampleDeadLetterQueueDepths();
  return sample.depths.reduce((total, entry) => total + entry.total, 0);
}
