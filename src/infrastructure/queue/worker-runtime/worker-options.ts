/**
 * Shared BullMQ worker options for stalled job handling.
 * Use these so locks and stall detection are explicit and consistent.
 *
 * @see https://docs.bullmq.io/guide/jobs/stalled
 */
import {
  BULLMQ_DEFAULT_LOCK_DURATION_MS,
  BULLMQ_RETENTION_LOCK_DURATION_MS,
  BULLMQ_STALLED_INTERVAL_MS,
  BULLMQ_WEBHOOK_LOCK_DURATION_MS,
} from '@/shared/constants/ttl.constants.js';

/** Scheduled retention/cleanup workers run one job at a time (bulk deletes). */
export const RETENTION_WORKER_CONCURRENCY = 1;

/**
 * Default options for short-running jobs (mail, notification).
 * lockDuration 30s; job stalls after 1 failure to renew.
 */
export function getDefaultWorkerOptions(): {
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount: number;
  jobTimeout: number;
} {
  return {
    lockDuration: BULLMQ_DEFAULT_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
    jobTimeout: BULLMQ_DEFAULT_LOCK_DURATION_MS * 2,
  };
}

/**
 * Options for webhook delivery: HTTP call can take up to 30s.
 * Longer lock so the job does not stall during fetch; allow 2 stalls before failing.
 */
export function getWebhookWorkerOptions(): {
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount: number;
  jobTimeout: number;
} {
  return {
    lockDuration: BULLMQ_WEBHOOK_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 2,
    jobTimeout: BULLMQ_WEBHOOK_LOCK_DURATION_MS * 2,
  };
}

/**
 * Options for retention/cleanup workers (audit retention, session cleanup).
 * Bulk deletes may exceed 30s; use 2-minute lock.
 */
export function getRetentionWorkerOptions(): {
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount: number;
  jobTimeout: number;
} {
  return {
    lockDuration: BULLMQ_RETENTION_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
    jobTimeout: BULLMQ_RETENTION_LOCK_DURATION_MS * 2,
  };
}
