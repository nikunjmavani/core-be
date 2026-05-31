/**
 * Central registry for BullMQ repeatable jobs (cleanup / retention).
 * Worker processors live in domains; this module only calls upsertJobScheduler.
 */

import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import { NOTIFICATION_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/workers/notification-retention.constants.js';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';
import { WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/workers/webhook-tombstone-retention.constants.js';
import { ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.constants.js';
import { USER_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/user/workers/user-tombstone-retention.constants.js';
import { ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/workers/organization-tombstone-retention.constants.js';
import { MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/membership/workers/membership-tombstone-retention.constants.js';
import { MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.constants.js';
import { ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/tenancy/sub-domains/organization/organization-api-key/workers/organization-api-key-tombstone-retention.constants.js';
import { UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME } from '@/domains/upload/workers/upload-tombstone-retention.constants.js';
import { UPLOAD_PENDING_SWEEP_QUEUE_NAME } from '@/domains/upload/workers/upload-pending-sweep.constants.js';
import { USER_DATA_EXPORT_RETENTION_QUEUE_NAME } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.constants.js';
import { IDEMPOTENCY_CARDINALITY_QUEUE_NAME } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.constants.js';
import { DLQ_DEPTH_QUEUE_NAME } from '@/infrastructure/observability/dlq-depth/dlq-depth.constants.js';
import { MAIL_OUTBOX_SWEEPER_QUEUE_NAME } from '@/infrastructure/mail/workers/mail-outbox-sweeper.constants.js';
import { COMMIT_DISPATCH_RECOVERY_QUEUE_NAME } from '@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.constants.js';
import {
  DLQ_AUTO_RETRY_QUEUE_NAME,
  DEFAULT_DLQ_AUTO_RETRY_CRON,
} from '@/infrastructure/queue/dlq/dlq-auto-retry.constants.js';
import { STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.constants.js';
import { STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.constants.js';
import { AUDIT_EXPORT_QUEUE_NAME } from '@/domains/audit/workers/audit-export.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * One row in the canonical scheduler registry: maps a BullMQ queue to its stable
 * `schedulerId` (used by BullMQ for upsert deduplication), the cron-driven job name, and
 * the cron pattern. The optional `timezone` is forwarded to BullMQ as `tz` and is sourced
 * from `SCHEDULER_TIMEZONE` so all scheduled runs agree on a wall clock.
 */
export interface ScheduledJob {
  queueName: string;
  schedulerId: string;
  jobName: string;
  cronPattern: string;
  /** Passed to BullMQ as `tz` when set. */
  timezone?: string;
}

/**
 * Lifecycle handle returned by {@link registerScheduledJobs}. `close()` closes every
 * BullMQ producer that was opened to register the cron schedules (best-effort, never
 * throws), so the scheduler-only handle can be drained alongside worker handles.
 */
export interface SchedulerHandle {
  close: () => Promise<void>;
}

const DEFAULT_AUDIT_RETENTION_CRON = '0 3 * * *';
/** In-app notification row retention purge (runs after audit cleanup). */
const DEFAULT_NOTIFICATION_RETENTION_CRON = '30 3 * * *';
const DEFAULT_SESSION_CLEANUP_CRON = '0 4 * * *';
/** GDPR export artifact purge runs before upload tombstone retention. */
const DEFAULT_USER_DATA_EXPORT_RETENTION_CRON = '44 5 * * *';
/** Tombstone purge order: uploads → organizations → child tombstones → users (FK-safe). */
const DEFAULT_UPLOAD_TOMBSTONE_RETENTION_CRON = '45 5 * * *';
const DEFAULT_ORGANIZATION_TOMBSTONE_RETENTION_CRON = '46 5 * * *';
const DEFAULT_WEBHOOK_TOMBSTONE_RETENTION_CRON = '47 5 * * *';
const DEFAULT_ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_CRON = '48 5 * * *';
const DEFAULT_MEMBERSHIP_TOMBSTONE_RETENTION_CRON = '50 5 * * *';
const DEFAULT_MEMBER_ROLE_TOMBSTONE_RETENTION_CRON = '51 5 * * *';
const DEFAULT_ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_CRON = '52 5 * * *';
const DEFAULT_USER_TOMBSTONE_RETENTION_CRON = '53 5 * * *';
const DEFAULT_IDEMPOTENCY_CARDINALITY_CRON = '*/15 * * * *';
const DEFAULT_DLQ_DEPTH_CRON = '*/15 * * * *';
const DEFAULT_MAIL_OUTBOX_SWEEPER_CRON = '*/10 * * * *';
const DEFAULT_COMMIT_DISPATCH_RECOVERY_CRON = '*/5 * * * *';
/** PENDING upload reconciliation runs hourly (independent of tombstone retention). */
const DEFAULT_UPLOAD_PENDING_SWEEP_CRON = '15 * * * *';
const DEFAULT_STRIPE_WEBHOOK_EVENT_RECLAIM_CRON = '*/5 * * * *';
const DEFAULT_STRIPE_WEBHOOK_EVENT_RETENTION_CRON = '0 3 * * *';
const DEFAULT_AUDIT_EXPORT_CRON = '15 2 * * *';

function withSchedulerTimezone(
  timezone: string | undefined,
  job: Omit<ScheduledJob, 'timezone'>,
): ScheduledJob {
  return timezone !== undefined ? { ...job, timezone } : job;
}

function getTombstoneRetentionScheduledJobs(timezone: string | undefined): ScheduledJob[] {
  return [
    withSchedulerTimezone(timezone, {
      queueName: USER_DATA_EXPORT_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-user-data-export-retention',
      jobName: 'purge-expired-user-data-exports',
      cronPattern: DEFAULT_USER_DATA_EXPORT_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-upload-tombstone-cleanup',
      jobName: 'purge-old-deleted-uploads',
      cronPattern: env.UPLOAD_TOMBSTONE_RETENTION_CRON ?? DEFAULT_UPLOAD_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-organization-tombstone-cleanup',
      jobName: 'purge-old-deleted-organizations',
      cronPattern:
        env.ORGANIZATION_TOMBSTONE_RETENTION_CRON ?? DEFAULT_ORGANIZATION_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: WEBHOOK_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-webhook-tombstone-cleanup',
      jobName: 'purge-old-deleted-webhooks',
      cronPattern: env.WEBHOOK_TOMBSTONE_RETENTION_CRON ?? DEFAULT_WEBHOOK_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-notification-policy-tombstone-cleanup',
      jobName: 'purge-old-deleted-notification-policies',
      cronPattern:
        env.ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_CRON ??
        DEFAULT_ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-membership-tombstone-cleanup',
      jobName: 'purge-old-deleted-memberships',
      cronPattern:
        env.MEMBERSHIP_TOMBSTONE_RETENTION_CRON ?? DEFAULT_MEMBERSHIP_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-member-role-tombstone-cleanup',
      jobName: 'purge-old-deleted-roles',
      cronPattern:
        env.MEMBER_ROLE_TOMBSTONE_RETENTION_CRON ?? DEFAULT_MEMBER_ROLE_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-organization-api-key-tombstone-cleanup',
      jobName: 'purge-old-deleted-api-keys',
      cronPattern:
        env.ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_CRON ??
        DEFAULT_ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: USER_TOMBSTONE_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-user-tombstone-cleanup',
      jobName: 'purge-old-deleted-users',
      cronPattern: env.USER_TOMBSTONE_RETENTION_CRON ?? DEFAULT_USER_TOMBSTONE_RETENTION_CRON,
    }),
  ];
}

/**
 * Canonical list of repeatable cleanup jobs (queue identity from domain constants).
 */
export function getScheduledJobs(): ScheduledJob[] {
  const schedulerTimezone = env.SCHEDULER_TIMEZONE;
  const timezone =
    schedulerTimezone !== undefined && schedulerTimezone.length > 0 ? schedulerTimezone : undefined;

  return [
    withSchedulerTimezone(timezone, {
      queueName: AUDIT_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-audit-cleanup',
      jobName: 'cleanup-old-logs',
      cronPattern: env.AUDIT_RETENTION_CRON ?? DEFAULT_AUDIT_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: NOTIFICATION_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-notification-retention',
      jobName: 'purge-old-notifications',
      cronPattern: env.NOTIFICATION_RETENTION_CRON ?? DEFAULT_NOTIFICATION_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: SESSION_CLEANUP_QUEUE_NAME,
      schedulerId: 'daily-session-cleanup',
      jobName: 'cleanup-sessions',
      cronPattern: env.AUTH_SESSION_CLEANUP_CRON ?? DEFAULT_SESSION_CLEANUP_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME,
      schedulerId: 'daily-stripe-webhook-event-cleanup',
      jobName: 'purge-old-stripe-webhook-events',
      cronPattern:
        env.STRIPE_WEBHOOK_EVENT_RETENTION_CRON ?? DEFAULT_STRIPE_WEBHOOK_EVENT_RETENTION_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: AUDIT_EXPORT_QUEUE_NAME,
      schedulerId: 'daily-audit-export',
      jobName: 'export-audit-logs-s3',
      cronPattern: env.AUDIT_EXPORT_CRON ?? DEFAULT_AUDIT_EXPORT_CRON,
    }),
    ...getTombstoneRetentionScheduledJobs(timezone),
    withSchedulerTimezone(timezone, {
      queueName: IDEMPOTENCY_CARDINALITY_QUEUE_NAME,
      schedulerId: 'idempotency-cardinality-quarter-hourly',
      jobName: 'sample-idempotency-cardinality',
      cronPattern: env.IDEMPOTENCY_CARDINALITY_CRON ?? DEFAULT_IDEMPOTENCY_CARDINALITY_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: DLQ_DEPTH_QUEUE_NAME,
      schedulerId: 'dlq-depth-quarter-hourly',
      jobName: 'sample-dlq-depth',
      cronPattern: env.DLQ_DEPTH_CRON ?? DEFAULT_DLQ_DEPTH_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: DLQ_AUTO_RETRY_QUEUE_NAME,
      schedulerId: 'dlq-auto-retry',
      jobName: 'auto-retry-dead-letter-jobs',
      cronPattern: env.DLQ_AUTO_RETRY_CRON ?? DEFAULT_DLQ_AUTO_RETRY_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: COMMIT_DISPATCH_RECOVERY_QUEUE_NAME,
      schedulerId: 'commit-dispatch-recovery',
      jobName: 'replay-stale-commit-dispatch',
      cronPattern: DEFAULT_COMMIT_DISPATCH_RECOVERY_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: MAIL_OUTBOX_SWEEPER_QUEUE_NAME,
      schedulerId: 'mail-outbox-sweeper',
      jobName: 're-enqueue-stale-pending-mail',
      cronPattern: env.MAIL_OUTBOX_SWEEPER_CRON ?? DEFAULT_MAIL_OUTBOX_SWEEPER_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: UPLOAD_PENDING_SWEEP_QUEUE_NAME,
      schedulerId: 'upload-pending-sweep',
      jobName: 'reconcile-stale-pending-uploads',
      cronPattern: env.UPLOAD_PENDING_SWEEP_CRON ?? DEFAULT_UPLOAD_PENDING_SWEEP_CRON,
    }),
    withSchedulerTimezone(timezone, {
      queueName: STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME,
      schedulerId: 'stripe-webhook-event-reclaim',
      jobName: 'reclaim-failed-stripe-webhook-events',
      cronPattern:
        env.STRIPE_WEBHOOK_EVENT_RECLAIM_CRON ?? DEFAULT_STRIPE_WEBHOOK_EVENT_RECLAIM_CRON,
    }),
  ];
}

/**
 * Options for {@link registerScheduledJobs}. Used by split worker services to avoid
 * registering cron schedules for queues whose worker is not running in this process —
 * otherwise BullMQ would enqueue jobs nobody picks up.
 */
export type RegisterScheduledJobsOptions = {
  /**
   * When set, only registers cron schedulers for queues that have an active worker in this
   * process (split worker services). Omit to register every canonical scheduled job.
   */
  readonly activeQueueNames?: ReadonlySet<string>;
};

/**
 * Registers repeatable jobs with BullMQ. No-op when SCHEDULER_ENABLED is false.
 */
export async function registerScheduledJobs(
  options: RegisterScheduledJobsOptions = {},
): Promise<SchedulerHandle> {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler.disabled');
    return {
      close: async () => {},
    };
  }

  const connection = getBullMQConnectionOptions();
  const allJobs = getScheduledJobs();
  const jobs =
    options.activeQueueNames === undefined
      ? allJobs
      : allJobs.filter((job) => options.activeQueueNames?.has(job.queueName));
  const queues: Queue[] = [];

  try {
    for (const job of jobs) {
      const queue = new Queue(job.queueName, { connection });
      queues.push(queue);
      await queue.upsertJobScheduler(
        job.schedulerId,
        {
          pattern: job.cronPattern,
          ...(job.timezone !== undefined ? { tz: job.timezone } : {}),
        },
        { name: job.jobName },
      );
      logger.info(
        {
          queueName: job.queueName,
          cronPattern: job.cronPattern,
          timezone: job.timezone ?? null,
        },
        'scheduler.job.registered',
      );
    }
  } catch (error) {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    throw error;
  }

  return {
    close: async () => {
      await Promise.allSettled(queues.map((queue) => queue.close()));
    },
  };
}
