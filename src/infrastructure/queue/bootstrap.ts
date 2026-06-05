/**
 * Queue bootstrap: registers BullMQ repeatable jobs, then starts domain workers.
 * Processor registration lives in domain worker files; queue families and pool demand
 * are centralized in worker-registration.registry.ts and worker-connection-budget.ts.
 */

import type { Worker } from 'bullmq';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { attachDeadLetterAndAlerting } from '@/infrastructure/queue/dlq/dead-letter.js';
import { registerScheduledJobs } from '@/infrastructure/queue/scheduler.js';
import { auditSchedulerRegistryConsistency } from '@/infrastructure/queue/worker-runtime/scheduler-registry-audit.js';
import {
  computeWorkerPostgresPoolDemand,
  resolveActiveWorkerQueueNames,
} from '@/infrastructure/queue/worker-runtime/worker-connection-budget.js';
import { getSelectedWorkerQueueFamilies } from '@/infrastructure/queue/worker-runtime/worker-queue-family.util.js';
import { getWorkerRegistrationsForFamilies } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { DomainContainers } from '@/worker-containers.js';

export { closeDeadLetterQueues } from '@/infrastructure/queue/dlq/dead-letter.js';

/**
 * Lifecycle handle returned by every worker factory (and the scheduler) so the
 * shutdown sequence can drain them uniformly. `worker` and `queueName` are present
 * for BullMQ workers and consumed by {@link attachDeadLetterAndAlerting}; they are
 * absent for the scheduler-only handle which has no `failed` event source.
 */
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

/**
 * Boots every BullMQ worker selected by `WORKER_QUEUE_FAMILIES` for the current
 * process: starts RSS monitoring, audits the registry against the scheduler cron
 * list, registers repeatable jobs for queues that have a worker locally, then
 * instantiates each worker (skipping `mail` / `stripe-webhook` when their secrets
 * are missing) and attaches the DLQ + Sentry `failed` listener via
 * {@link attachDeadLetterAndAlerting}. Returned handles are drained in reverse
 * order during shutdown.
 */
export async function registerDomainWorkers(
  workerContainers: DomainContainers,
): Promise<WorkerHandle[]> {
  const workers: WorkerHandle[] = [];
  const selectedFamilies = getSelectedWorkerQueueFamilies();
  const poolDemand = computeWorkerPostgresPoolDemand({
    families: selectedFamilies,
    workerContainers,
  });

  startRssMonitoring();

  logger.info(
    {
      selectedFamilies,
      peakPostgresConcurrency: poolDemand.peakPostgresConcurrency,
      peakPostgresConcurrencyHoldingExternalIo: poolDemand.peakPostgresConcurrencyHoldingExternalIo,
      enabledPostgresQueues: poolDemand.queues
        .filter((entry) => entry.enabled && entry.postgresConcurrency > 0)
        .map((entry) => ({
          queueName: entry.queueName,
          postgresConcurrency: entry.postgresConcurrency,
          holdsConnectionDuringExternalIo: entry.holdsConnectionDuringExternalIo,
          criticality: entry.criticality,
        })),
    },
    'worker.queue_families.selected',
  );

  auditSchedulerRegistryConsistency();

  const activeQueueNames = resolveActiveWorkerQueueNames({
    families: selectedFamilies,
    workerContainers,
  });
  const schedulerHandle = await registerScheduledJobs({ activeQueueNames });
  workers.push(schedulerHandle);

  const registrations = getWorkerRegistrationsForFamilies(selectedFamilies);

  for (const registration of registrations) {
    if (registration.isEnabled !== undefined && !registration.isEnabled(workerContainers)) {
      if (registration.queueName === MAIL_QUEUE_NAME) {
        logger.warn('RESEND_API_KEY not configured — mail worker skipped');
      } else if (registration.queueName === STRIPE_WEBHOOK_QUEUE_NAME) {
        logger.warn(
          'STRIPE_WEBHOOK_SECRET not configured — stripe webhook ingress and worker skipped',
        );
      }
      continue;
    }

    pushWorkerWithDeadLetterHook(workers, () => registration.create(workerContainers));
    logger.info({ queueName: registration.queueName }, `Registered ${registration.logLabel}`);
  }

  return workers;
}
