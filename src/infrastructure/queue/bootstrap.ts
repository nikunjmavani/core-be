/**
 * Queue bootstrap: registers BullMQ repeatable jobs, then starts domain workers.
 * Processor registration lives in domain worker files only.
 */

import type { Worker } from 'bullmq';
import { createMailWorker } from '@/infrastructure/mail/workers/mail.worker.js';
import { createMailOutboxSweeperWorker } from '@/infrastructure/mail/workers/mail-outbox-sweeper.worker.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { createWebhookDeliveryWorker } from '@/domains/notify/sub-domains/webhook/workers/webhook-delivery.worker.js';
import { createNotificationWorker } from '@/domains/notify/sub-domains/notification/workers/notification.worker.js';
import { createAuditRetentionWorker } from '@/domains/audit/workers/audit-retention.worker.js';
import { createAuditExportWorker } from '@/domains/audit/workers/audit-export.worker.js';
import { createSessionCleanupWorker } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.worker.js';
import { createWebhookTombstoneRetentionWorker } from '@/domains/notify/sub-domains/webhook/workers/webhook-tombstone-retention.worker.js';
import { createOrganizationNotificationPolicyTombstoneRetentionWorker } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.worker.js';
import { createUserTombstoneRetentionWorker } from '@/domains/user/workers/user-tombstone-retention.worker.js';
import { createOrganizationTombstoneRetentionWorker } from '@/domains/tenancy/sub-domains/organization/workers/organization-tombstone-retention.worker.js';
import { createMembershipTombstoneRetentionWorker } from '@/domains/tenancy/sub-domains/membership/workers/membership-tombstone-retention.worker.js';
import { createMemberRoleTombstoneRetentionWorker } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.worker.js';
import { createOrganizationApiKeyTombstoneRetentionWorker } from '@/domains/tenancy/sub-domains/organization/organization-api-key/workers/organization-api-key-tombstone-retention.worker.js';
import { createUploadTombstoneRetentionWorker } from '@/domains/upload/workers/upload-tombstone-retention.worker.js';
import { createUploadPendingSweepWorker } from '@/domains/upload/workers/upload-pending-sweep.worker.js';
import { createUserDataExportWorker } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export.worker.js';
import { createUserDataExportRetentionWorker } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.worker.js';
import { createIdempotencyCardinalityWorker } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.worker.js';
import { createDlqDepthWorker } from '@/infrastructure/observability/dlq-depth/dlq-depth.worker.js';
import { createStripeWebhookWorkerIfConfigured } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.worker.js';
import { createStripeWebhookEventRetentionWorker } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.worker.js';
import { createStripeWebhookEventReclaimWorker } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.worker.js';
import { createNotificationRetentionWorker } from '@/domains/notify/sub-domains/notification/workers/notification-retention.worker.js';
import { createPartitionMaintenanceWorker } from '@/infrastructure/queue/partition-maintenance/partition-maintenance.worker.js';
import { attachDeadLetterAndAlerting } from '@/infrastructure/queue/dlq/dead-letter.js';
import { registerScheduledJobs } from '@/infrastructure/queue/scheduler.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { WorkerContainers } from '@/worker-containers.js';

export { closeDeadLetterQueues } from '@/infrastructure/queue/dlq/dead-letter.js';

export interface WorkerHandle {
  close: () => Promise<void>;
  /** Set for BullMQ worker processors; omitted for the scheduler-only handle. */
  worker?: Worker;
  queueName?: string;
}

const RSS_WARNING_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512 MB
let rssMonitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic RSS monitoring for the worker process.
 * Warns if memory usage exceeds 512 MB.
 */
function startRssMonitoring(): void {
  rssMonitorInterval = setInterval(() => {
    const rssBytes = process.memoryUsage().rss;
    if (rssBytes > RSS_WARNING_THRESHOLD_BYTES) {
      const rssMegabytes = Math.round(rssBytes / 1024 / 1024);
      logger.warn({ rssMegabytes, thresholdMegabytes: 512 }, 'worker.rss.exceeds.threshold');
    }
  }, 30_000); // Check every 30 seconds
}

/**
 * Stop RSS monitoring.
 */
export function stopRssMonitoring(): void {
  if (rssMonitorInterval) {
    clearInterval(rssMonitorInterval);
    rssMonitorInterval = null;
  }
}

function pushWorkerWithDeadLetterHook(
  workers: WorkerHandle[],
  createWorker: () => WorkerHandle,
): void {
  const handle = createWorker();
  workers.push(handle);
  if (handle.worker !== undefined && handle.queueName !== undefined) {
    attachDeadLetterAndAlerting(handle.worker, handle.queueName);
  }
}

export async function registerDomainWorkers(
  workerContainers: WorkerContainers,
): Promise<WorkerHandle[]> {
  const workers: WorkerHandle[] = [];

  // Start RSS monitoring for worker process
  startRssMonitoring();

  const schedulerHandle = await registerScheduledJobs();
  workers.push(schedulerHandle);

  // ── Throughput queue families (separate Worker instances + per-family concurrency) ──

  // Mail family (outbox sweeper + send worker when RESEND_API_KEY is set)
  pushWorkerWithDeadLetterHook(workers, createMailOutboxSweeperWorker);
  logger.info('Registered mail outbox sweeper worker');

  if (isMailConfigured()) {
    pushWorkerWithDeadLetterHook(workers, createMailWorker);
    logger.info('Registered mail worker');
  } else {
    logger.warn('RESEND_API_KEY not configured — mail worker skipped');
  }

  // Webhook-delivery family (outbound HTTP; WORKER_CONCURRENCY_WEBHOOK)
  pushWorkerWithDeadLetterHook(workers, createWebhookDeliveryWorker);
  logger.info('Registered webhook delivery worker');

  // Notification family (channel dispatch; WORKER_CONCURRENCY_NOTIFY)
  pushWorkerWithDeadLetterHook(workers, createNotificationWorker);
  logger.info('Registered notification worker');

  pushWorkerWithDeadLetterHook(workers, () =>
    createUserDataExportWorker(workerContainers.userDomain.userDataExportService),
  );
  logger.info('Registered user data export worker');

  // Retention worker processors (repeatable schedules: scheduler.ts)
  pushWorkerWithDeadLetterHook(workers, createAuditRetentionWorker);
  logger.info('Registered audit retention worker');

  pushWorkerWithDeadLetterHook(workers, createAuditExportWorker);
  logger.info('Registered audit export worker');

  pushWorkerWithDeadLetterHook(workers, createSessionCleanupWorker);
  logger.info('Registered session cleanup worker');

  pushWorkerWithDeadLetterHook(workers, createNotificationRetentionWorker);
  logger.info('Registered notification retention worker');

  pushWorkerWithDeadLetterHook(workers, createStripeWebhookEventRetentionWorker);
  logger.info('Registered stripe webhook event retention worker');

  pushWorkerWithDeadLetterHook(workers, createStripeWebhookEventReclaimWorker);
  logger.info('Registered stripe webhook event reclaim worker');

  pushWorkerWithDeadLetterHook(workers, createPartitionMaintenanceWorker);
  logger.info('Registered partition maintenance worker');

  pushWorkerWithDeadLetterHook(workers, createWebhookTombstoneRetentionWorker);
  logger.info('Registered webhook tombstone retention worker');

  pushWorkerWithDeadLetterHook(
    workers,
    createOrganizationNotificationPolicyTombstoneRetentionWorker,
  );
  logger.info('Registered organization notification policy tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createUserTombstoneRetentionWorker);
  logger.info('Registered user tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createOrganizationTombstoneRetentionWorker);
  logger.info('Registered organization tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createMembershipTombstoneRetentionWorker);
  logger.info('Registered membership tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createMemberRoleTombstoneRetentionWorker);
  logger.info('Registered member role tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createOrganizationApiKeyTombstoneRetentionWorker);
  logger.info('Registered organization API key tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createUploadTombstoneRetentionWorker);
  logger.info('Registered upload tombstone retention worker');

  pushWorkerWithDeadLetterHook(workers, createUploadPendingSweepWorker);
  logger.info('Registered upload pending sweep worker');

  pushWorkerWithDeadLetterHook(workers, createUserDataExportRetentionWorker);
  logger.info('Registered user data export retention worker');

  pushWorkerWithDeadLetterHook(workers, createIdempotencyCardinalityWorker);
  logger.info('Registered idempotency cardinality worker');

  pushWorkerWithDeadLetterHook(workers, createDlqDepthWorker);
  logger.info('Registered DLQ depth monitoring worker');

  // Stripe webhook family (WORKER_CONCURRENCY_STRIPE; requires STRIPE_SECRET_KEY)
  const stripeWebhookWorker = createStripeWebhookWorkerIfConfigured(workerContainers.billingDomain);
  if (stripeWebhookWorker) {
    pushWorkerWithDeadLetterHook(workers, () => stripeWebhookWorker);
    logger.info('Registered stripe webhook worker');
  } else {
    logger.warn('STRIPE_WEBHOOK_SECRET not configured — stripe webhook ingress and worker skipped');
  }

  return workers;
}
