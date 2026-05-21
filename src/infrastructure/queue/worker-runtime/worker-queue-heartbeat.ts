import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { WORKER_QUEUE_HEARTBEAT_TTL_SECONDS } from '@/shared/constants/index.js';

const WORKER_QUEUE_LAST_JOB_KEY_PREFIX = 'worker:queue:';
const WORKER_QUEUE_LAST_JOB_KEY_SUFFIX = ':last_job_at';

function buildQueueHeartbeatKey(queueName: string): string {
  return `${WORKER_QUEUE_LAST_JOB_KEY_PREFIX}${queueName}${WORKER_QUEUE_LAST_JOB_KEY_SUFFIX}`;
}

/**
 * Records ISO-8601 timestamp when a worker finishes processing a job (Redis, 24h TTL).
 */
export async function recordWorkerQueueJobCompleted(queueName: string): Promise<void> {
  await redisConnection.set(
    buildQueueHeartbeatKey(queueName),
    new Date().toISOString(),
    'EX',
    WORKER_QUEUE_HEARTBEAT_TTL_SECONDS,
  );
}

export type WorkerQueueHeartbeat = {
  queue: string;
  last_job_at: string | null;
};

/** Throughput queues whose heartbeats indicate the worker is processing jobs. */
export const WORKER_THROUGHPUT_QUEUE_NAMES = [
  'mail',
  'webhook-delivery',
  'notification',
  'stripe-webhook',
] as const;

/**
 * True when every recorded throughput heartbeat is older than `stallTimeoutMs`.
 * Returns false when no jobs have completed yet (cold start / idle before first job).
 */
export function isWorkerThroughputStalled(
  heartbeats: readonly WorkerQueueHeartbeat[],
  stallTimeoutMs: number,
  nowMilliseconds: number = Date.now(),
): boolean {
  const recorded = heartbeats.filter((heartbeat) => heartbeat.last_job_at !== null);
  if (recorded.length === 0) {
    return false;
  }
  return recorded.every((heartbeat) => {
    const completedAt = Date.parse(heartbeat.last_job_at as string);
    if (!Number.isFinite(completedAt)) {
      return false;
    }
    return nowMilliseconds - completedAt > stallTimeoutMs;
  });
}

/**
 * Reads last job completion timestamps for the given BullMQ queue names.
 */
export async function readWorkerQueueHeartbeats(
  queueNames: readonly string[],
): Promise<WorkerQueueHeartbeat[]> {
  const keys = queueNames.map((name) => buildQueueHeartbeatKey(name));
  if (keys.length === 0) {
    return [];
  }
  const values = await redisConnection.mget(...keys);
  return queueNames.map((queue, index) => ({
    queue,
    // eslint-disable-next-line security/detect-object-injection -- index from typed Array.map over queueNames.
    last_job_at: values[index] ?? null,
  }));
}

export function attachWorkerQueueHeartbeat(
  worker: { on(event: 'completed', listener: () => void): void },
  queueName: string,
): void {
  worker.on('completed', () => {
    void recordWorkerQueueJobCompleted(queueName).catch(() => {
      /* heartbeat is best-effort */
    });
  });
}
