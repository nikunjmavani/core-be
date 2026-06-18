import { Queue } from 'bullmq';
import type { Job, Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import {
  recordBullMQJobDuration,
  setBullMQQueueCounts,
} from '@/infrastructure/observability/metrics/prometheus-metrics.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Primary job queues scraped for depth gauges (excludes per-source DLQ queues). */
export const MONITORED_BULLMQ_QUEUE_NAMES = [
  'mail',
  'mail-outbox-sweeper',
  'webhook-delivery',
  'notification',
  'stripe-webhook',
  'stripe-webhook-event-reclaim',
  'audit-retention',
  'session-cleanup',
  'webhook-tombstone-retention',
  'organization-notification-policy-tombstone-retention',
  'user-tombstone-retention',
  'organization-tombstone-retention',
  'membership-tombstone-retention',
  'member-role-tombstone-retention',
  'organization-api-key-tombstone-retention',
  'upload-tombstone-retention',
  'idempotency-cardinality',
  'dlq-depth',
] as const;

const queueClientsByName = new Map<string, Queue>();

function getOrCreateQueueClient(queueName: string): Queue {
  const existing = queueClientsByName.get(queueName);
  if (existing) return existing;
  const queue = new Queue(queueName, { connection: getBullMQConnectionOptions() });
  queueClientsByName.set(queueName, queue);
  return queue;
}

/**
 * Refreshes `bullmq_queue_{waiting,active,delayed,failed}` gauges for every
 * queue in {@link MONITORED_BULLMQ_QUEUE_NAMES}. No-op when metrics are
 * disabled; per-queue Redis errors are logged at warn and do not abort the pass.
 */
export async function refreshBullMQQueueGauges(): Promise<void> {
  if (!isMetricsEnabled()) {
    return;
  }

  await Promise.all(
    MONITORED_BULLMQ_QUEUE_NAMES.map(async (queueName) => {
      try {
        const queue = getOrCreateQueueClient(queueName);
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        setBullMQQueueCounts(queueName, {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        });
      } catch (error) {
        logger.warn({ queueName, error }, 'metrics.bullmq.queue_counts.failed');
      }
    }),
  );
}

/**
 * Sums `waiting + delayed` job counts across `queueNames`, reusing the pooled metrics
 * `Queue` clients.
 *
 * @remarks
 * Used by the worker readiness probe to distinguish a genuinely stalled worker (pending
 * work but no recent completions) from a healthy idle worker (nothing queued). On a
 * per-queue read failure the queue contributes 0 — a transient count error must not be
 * read as "work is piling up" and trigger a restart loop; a real Redis outage is caught
 * independently by the dependency readiness probe.
 */
export async function readQueuesPendingWorkTotal(queueNames: readonly string[]): Promise<number> {
  const perQueueCounts = await Promise.all(
    queueNames.map(async (queueName) => {
      try {
        const queue = getOrCreateQueueClient(queueName);
        const counts = await queue.getJobCounts('waiting', 'delayed');
        return (counts.waiting ?? 0) + (counts.delayed ?? 0);
      } catch (error) {
        logger.warn({ queueName, error }, 'worker.health.pending_work_count.failed');
        return 0;
      }
    }),
  );
  return perQueueCounts.reduce((total, value) => total + value, 0);
}

/**
 * Closes every pooled `Queue` client created by {@link refreshBullMQQueueGauges}
 * so the metrics scraper releases its Redis sockets cleanly on shutdown.
 */
export async function closeBullMQMetricsQueues(): Promise<void> {
  const queues = [...queueClientsByName.values()];
  queueClientsByName.clear();
  await Promise.allSettled(queues.map((queue) => queue.close()));
}

function resolveJobDurationSeconds(job: Job): number | null {
  const finishedAt = job.finishedOn;
  const processedAt = job.processedOn;
  if (finishedAt === undefined || processedAt === undefined) {
    return null;
  }
  return Math.max(0, (finishedAt - processedAt) / 1000);
}

/**
 * Records job duration histogram samples on worker `completed` events.
 */
export function attachBullMQJobMetrics(worker: Worker, queueName: string): void {
  if (!isMetricsEnabled()) {
    return;
  }

  worker.on('completed', async (job) => {
    if (!job) return;

    const durationSeconds = resolveJobDurationSeconds(job);
    if (durationSeconds === null) {
      return;
    }
    recordBullMQJobDuration(queueName, job.name, durationSeconds);
  });
}
