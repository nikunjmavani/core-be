/**
 * Post-deploy worker readiness probe — DLQ depth + queue heartbeats on the worker HTTP server.
 *
 * Usage:
 *   WORKER_HEALTH_URL=http://127.0.0.1:9090 pnpm tool:worker-readiness
 */
import '@/shared/config/load-env-files.js';
import { parseArgs } from 'node:util';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DEFAULT_WORKER_HEALTH_URL = 'http://127.0.0.1:9090';
const MAX_DLQ_DEPTH = 500;
const MAX_QUEUE_STALE_MS = 10 * 60 * 1000;

type WorkerQueueHeartbeat = {
  queue: string;
  last_job_at: string | null;
};

type WorkerHealthPayload = {
  status?: string;
  worker_queues?: WorkerQueueHeartbeat[];
};

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchWorkerHealth(baseUrl: string): Promise<WorkerHealthPayload> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Worker health returned HTTP ${String(response.status)}`);
  }
  return (await response.json()) as WorkerHealthPayload;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      'max-dlq': { type: 'string', default: String(MAX_DLQ_DEPTH) },
      'max-stale-ms': { type: 'string', default: String(MAX_QUEUE_STALE_MS) },
    },
  });

  const workerHealthUrl = values.url ?? process.env.WORKER_HEALTH_URL ?? DEFAULT_WORKER_HEALTH_URL;
  const maxDlq = Number.parseInt(values['max-dlq'] ?? String(MAX_DLQ_DEPTH), 10);
  const maxStaleMs = Number.parseInt(values['max-stale-ms'] ?? String(MAX_QUEUE_STALE_MS), 10);

  const [health, dlqDepth] = await Promise.all([
    fetchWorkerHealth(workerHealthUrl),
    getTotalDeadLetterJobCount(),
  ]);

  if (health.status !== 'ok') {
    throw new Error(`Worker health status is not ok: ${health.status ?? 'unknown'}`);
  }

  if (dlqDepth > maxDlq) {
    throw new Error(`DLQ depth ${String(dlqDepth)} exceeds max ${String(maxDlq)}`);
  }

  const now = Date.now();
  const monitoredQueues = health.worker_queues ?? [];
  const queuesWithHeartbeats = monitoredQueues.filter((entry) => entry.last_job_at !== null);
  const staleQueues = queuesWithHeartbeats.filter((entry) => {
    const lastMs = parseIsoMs(entry.last_job_at);
    if (lastMs === null) return true;
    return now - lastMs > maxStaleMs;
  });

  if (staleQueues.length > 0) {
    throw new Error(
      `Worker queues without recent jobs: ${staleQueues.map((entry) => entry.queue).join(', ')}`,
    );
  }

  logger.info(
    { dlqDepth, workerHealthUrl, queueCount: monitoredQueues.length },
    'worker-readiness.ok',
  );
  await closeDatabase();
}

main().catch((error) => {
  logger.error({ error }, 'worker-readiness.failed');
  process.exitCode = 1;
});
