/**
 * Shared BullMQ worker options for stalled job handling.
 * Use these so locks and stall detection are explicit and consistent.
 *
 * @remarks
 * BullMQ does NOT expose a `jobTimeout` field on `WorkerOptions` (verified against
 * `node_modules/bullmq/dist/esm/interfaces/worker-options.d.ts` and `base-job-options.d.ts`).
 * The effective wall-clock bound BullMQ enforces on a stuck processor is therefore:
 *
 *   `lockDuration + maxStalledCount × stalledInterval`
 *
 * — when a processor hangs the lock expires after `lockDuration`, the stalled checker moves
 * the job back to wait up to `maxStalledCount` times, then fails it. Concurrency-slot release
 * inherits the same timing.
 *
 * For true per-job cancellation (free the connection too, not just the slot) the processor
 * itself must thread an `AbortSignal` into its outbound I/O. Webhook delivery already does this
 * via `outboundCall(signal)`; if other workers grow real cancellation needs, follow that pattern
 * rather than wrapping in `Promise.race` (which leaves the loser hanging onto its DB connection
 * even after the timeout rejects — making slot-vs-pool exhaustion *worse*, not better).
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
} {
  return {
    lockDuration: BULLMQ_DEFAULT_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
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
} {
  return {
    lockDuration: BULLMQ_WEBHOOK_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 2,
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
} {
  return {
    lockDuration: BULLMQ_RETENTION_LOCK_DURATION_MS,
    stalledInterval: BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
  };
}
