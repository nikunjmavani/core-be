/**
 * Post-deploy worker readiness probe.
 *
 * Verifies the BullMQ worker fleet is healthy from outside the worker container.
 * Railway worker services are deployed without a public HTTP domain (only the
 * API service exposes one), so the default "redis" mode reaches the same signals
 * the worker's internal /readyz endpoint exposes by reading them straight from
 * Redis + Postgres + BullMQ:
 *
 *   - DLQ depth (Redis) — total waiting + failed jobs across dead-letter queues.
 *   - Throughput queue heartbeats (Redis) — last-completed-at per monitored queue.
 *   - Dependency readiness probes — Postgres `select 1`, Redis ping, BullMQ ping.
 *
 * The "http" mode is preserved for local dev and any environment that does
 * publicly expose the worker /readyz server (set --url or WORKER_HEALTH_URL).
 *
 * Usage:
 *   pnpm tool:worker-readiness                       # redis-direct (default)
 *   pnpm tool:worker-readiness --max-dlq 100
 *   WORKER_HEALTH_URL=http://127.0.0.1:9090 pnpm tool:worker-readiness
 *   pnpm tool:worker-readiness --url http://127.0.0.1:9090 --mode http
 */
import '@/shared/config/load-env-files.js';
import { parseArgs } from 'node:util';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import {
  closeBullMqRedis,
  connectBullMqRedis,
} from '@/infrastructure/cache/bullmq-redis.client.js';
import { closeRedis, connectRedis } from '@/infrastructure/cache/redis.client.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import {
  readWorkerQueueHeartbeats,
  WORKER_THROUGHPUT_QUEUE_NAMES,
  type WorkerQueueHeartbeat,
} from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import { runDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DEFAULT_MAX_DLQ_DEPTH = 500;
const DEFAULT_MAX_QUEUE_STALE_MS = 10 * 60 * 1000;
const HTTP_FETCH_TIMEOUT_MS = 15_000;

type WorkerReadinessMode = 'redis' | 'http';

type WorkerHealthPayload = {
  status?: string;
  worker_queues?: WorkerQueueHeartbeat[];
};

interface WorkerReadinessOptions {
  mode: WorkerReadinessMode;
  workerHealthUrl: string | null;
  maxDlqDepth: number;
  maxStaleMs: number;
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findStaleQueues({
  heartbeats,
  maxStaleMs,
  nowMs,
}: {
  heartbeats: readonly WorkerQueueHeartbeat[];
  maxStaleMs: number;
  nowMs: number;
}): readonly WorkerQueueHeartbeat[] {
  const recorded = heartbeats.filter((heartbeat) => heartbeat.last_job_at !== null);
  return recorded.filter((heartbeat) => {
    const lastMs = parseIsoMs(heartbeat.last_job_at);
    if (lastMs === null) return true;
    return nowMs - lastMs > maxStaleMs;
  });
}

async function fetchWorkerHealth(baseUrl: string): Promise<WorkerHealthPayload> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/readyz`, {
    signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Worker health returned HTTP ${String(response.status)}`);
  }
  return (await response.json()) as WorkerHealthPayload;
}

async function probeViaHttp({
  workerHealthUrl,
}: {
  workerHealthUrl: string;
}): Promise<{ heartbeats: WorkerQueueHeartbeat[]; statusOk: boolean }> {
  const health = await fetchWorkerHealth(workerHealthUrl);
  if (health.status !== 'ok') {
    throw new Error(`Worker health status is not ok: ${health.status ?? 'unknown'}`);
  }
  return {
    heartbeats: health.worker_queues ?? [],
    statusOk: true,
  };
}

async function probeViaRedis(): Promise<{ heartbeats: WorkerQueueHeartbeat[]; statusOk: boolean }> {
  await Promise.all([connectRedis(), connectBullMqRedis()]);
  const readiness = await runDependencyReadinessProbes();
  if (readiness.status !== 'ok') {
    throw new Error(
      `Worker dependencies not ready: database=${readiness.database}, redis=${readiness.redis}, bullmq=${readiness.bullmq}`,
    );
  }
  const heartbeats = await readWorkerQueueHeartbeats(WORKER_THROUGHPUT_QUEUE_NAMES);
  return { heartbeats, statusOk: true };
}

function parseOptions(): WorkerReadinessOptions {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      mode: { type: 'string' },
      'max-dlq': { type: 'string', default: String(DEFAULT_MAX_DLQ_DEPTH) },
      'max-stale-ms': { type: 'string', default: String(DEFAULT_MAX_QUEUE_STALE_MS) },
    },
  });

  const explicitUrl = values.url ?? process.env.WORKER_HEALTH_URL ?? null;
  const explicitMode = values.mode === 'http' || values.mode === 'redis' ? values.mode : null;
  const mode: WorkerReadinessMode = explicitMode ?? (explicitUrl ? 'http' : 'redis');

  if (mode === 'http' && !explicitUrl) {
    throw new Error('--mode http requires --url or WORKER_HEALTH_URL.');
  }

  const maxDlqDepth = Number.parseInt(values['max-dlq'] ?? String(DEFAULT_MAX_DLQ_DEPTH), 10);
  const maxStaleMs = Number.parseInt(
    values['max-stale-ms'] ?? String(DEFAULT_MAX_QUEUE_STALE_MS),
    10,
  );

  if (!Number.isFinite(maxDlqDepth) || maxDlqDepth < 0) {
    throw new Error(`Invalid --max-dlq: ${values['max-dlq']}`);
  }
  if (!Number.isFinite(maxStaleMs) || maxStaleMs <= 0) {
    throw new Error(`Invalid --max-stale-ms: ${values['max-stale-ms']}`);
  }

  return { mode, workerHealthUrl: explicitUrl, maxDlqDepth, maxStaleMs };
}

async function runWorkerReadiness(options: WorkerReadinessOptions): Promise<void> {
  const probe =
    options.mode === 'http' && options.workerHealthUrl
      ? probeViaHttp({ workerHealthUrl: options.workerHealthUrl })
      : probeViaRedis();

  const [{ heartbeats }, dlqDepth] = await Promise.all([probe, getTotalDeadLetterJobCount()]);

  if (dlqDepth > options.maxDlqDepth) {
    throw new Error(`DLQ depth ${String(dlqDepth)} exceeds max ${String(options.maxDlqDepth)}`);
  }

  const staleQueues = findStaleQueues({
    heartbeats,
    maxStaleMs: options.maxStaleMs,
    nowMs: Date.now(),
  });
  if (staleQueues.length > 0) {
    throw new Error(
      `Worker queues without recent jobs: ${staleQueues.map((entry) => entry.queue).join(', ')}`,
    );
  }

  logger.info(
    {
      mode: options.mode,
      dlqDepth,
      heartbeatCount: heartbeats.length,
      workerHealthUrl: options.workerHealthUrl,
    },
    'worker-readiness.ok',
  );
}

async function main(): Promise<void> {
  const options = parseOptions();
  try {
    await runWorkerReadiness(options);
  } finally {
    await Promise.allSettled([closeRedis(), closeBullMqRedis(), closeDatabase()]);
  }
}

main().catch((error) => {
  logger.error({ error }, 'worker-readiness.failed');
  process.exitCode = 1;
});
