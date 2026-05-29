import { getLatestMigrationVersion } from '@/infrastructure/database/migration/migration-version.js';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { countPendingMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { MONITORED_BULLMQ_QUEUE_NAMES } from '@/infrastructure/observability/metrics/bullmq-metrics.js';
import {
  readWorkerQueueHeartbeats,
  type WorkerQueueHeartbeat,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/index.js';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';

const OPERATIONAL_METRICS_CACHE_TTL_MILLISECONDS = MILLISECONDS_PER_MINUTE;

/** Operational health snapshot returned by {@link getCachedHealthOperationalMetrics} and surfaced on `/readyz`. */
export type HealthOperationalMetrics = {
  migration_version: string | null;
  mail_outbox_pending: number;
  dlq_depth: number;
  draining: boolean;
  worker_queues: WorkerQueueHeartbeat[];
};

let cachedOperationalMetrics: {
  value: HealthOperationalMetrics;
  expiresAt: number;
} | null = null;

/**
 * Operational signals for `/readyz` (cached 60s to limit DB/Redis load).
 */
export async function getCachedHealthOperationalMetrics(): Promise<HealthOperationalMetrics> {
  const now = Date.now();
  if (cachedOperationalMetrics && cachedOperationalMetrics.expiresAt > now) {
    return cachedOperationalMetrics.value;
  }

  const [migration_version, mail_outbox_pending, dlq_depth, worker_queues] = await Promise.all([
    getLatestMigrationVersion(),
    countPendingMailOutbox(),
    getTotalDeadLetterJobCount(),
    readWorkerQueueHeartbeats(MONITORED_BULLMQ_QUEUE_NAMES),
  ]);

  const value: HealthOperationalMetrics = {
    migration_version,
    mail_outbox_pending,
    dlq_depth,
    draining: isApplicationDraining(),
    worker_queues,
  };
  cachedOperationalMetrics = {
    value,
    expiresAt: now + OPERATIONAL_METRICS_CACHE_TTL_MILLISECONDS,
  };
  return value;
}

/** Test-only: clear operational metrics cache between tests. */
export function resetHealthOperationalMetricsCacheForTests(): void {
  cachedOperationalMetrics = null;
}
