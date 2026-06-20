import { getLatestMigrationVersion } from '@/infrastructure/database/migration/migration-version.js';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { countPendingMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import {
  getQueueDepths,
  MONITORED_BULLMQ_QUEUE_NAMES,
  type QueueDepth,
} from '@/infrastructure/observability/metrics/bullmq-metrics.js';
import {
  getWorkerQueueOperationalManifest,
  type WorkerQueueOperationalManifestEntry,
} from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import {
  readWorkerQueueHeartbeats,
  WORKER_THROUGHPUT_QUEUE_NAMES,
  type WorkerQueueHeartbeat,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/index.js';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import {
  snapshotManagedCircuitBreakers,
  type ManagedCircuitBreakerSnapshot,
} from '@/infrastructure/resilience/circuit-breaker.js';

const OPERATIONAL_METRICS_CACHE_TTL_MILLISECONDS = MILLISECONDS_PER_MINUTE;

/** Operational health snapshot returned by {@link getCachedHealthOperationalMetrics} and surfaced on `/readyz`. */
export type HealthOperationalMetrics = {
  migration_version: string | null;
  mail_outbox_pending: number;
  dlq_depth: number;
  draining: boolean;
  worker_queues: WorkerQueueHeartbeat[];
  worker_queue_manifest: readonly WorkerQueueOperationalManifestEntry[];
  /** External-dependency circuit breaker states (Stripe/S3/Resend/Turnstile) — visibility only. */
  circuit_breakers: ManagedCircuitBreakerSnapshot[];
  /** Waiting/delayed depth of the throughput queues (mail, webhook-delivery, notification, stripe-webhook). */
  queue_depths: QueueDepth[];
  /** True when any external circuit breaker is OPEN. Informational — does not by itself fail `/readyz`. */
  degraded: boolean;
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

  const [
    migration_version,
    mail_outbox_pending,
    dlq_depth,
    worker_queues,
    circuit_breakers,
    queue_depths,
  ] = await Promise.all([
    getLatestMigrationVersion(),
    countPendingMailOutbox(),
    getTotalDeadLetterJobCount(),
    readWorkerQueueHeartbeats(MONITORED_BULLMQ_QUEUE_NAMES),
    snapshotManagedCircuitBreakers(),
    getQueueDepths(WORKER_THROUGHPUT_QUEUE_NAMES),
  ]);

  const value: HealthOperationalMetrics = {
    migration_version,
    mail_outbox_pending,
    dlq_depth,
    draining: isApplicationDraining(),
    worker_queues,
    worker_queue_manifest: getWorkerQueueOperationalManifest(),
    circuit_breakers,
    queue_depths,
    degraded: circuit_breakers.some((breaker) => breaker.state === 'OPEN'),
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
