import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { sampleDeadLetterQueueDepths } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import {
  sampleBullMqSourceQueueWaitingDepth,
  sampleRedisMemorySaturation,
} from '@/infrastructure/observability/redis-saturation/redis-saturation.service.js';
import { DLQ_DEPTH_QUEUE_NAME } from '@/infrastructure/observability/dlq-depth/dlq-depth.constants.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Creates the BullMQ worker that runs the observability tick on a schedule: per-source DLQ
 * depth, BullMQ source-queue waiting backlog, and cache Redis memory saturation. Each
 * reading is fanned into Sentry alerts plus structured logs.
 *
 * @remarks
 * - **Algorithm:** per tick at concurrency 1, runs {@link sampleDeadLetterQueueDepths}, then
 *   {@link sampleBullMqSourceQueueWaitingDepth} and {@link sampleRedisMemorySaturation}. The
 *   latter two are independently guarded so one probe failure cannot suppress the others.
 * - **Failure modes:** a DLQ sampler error propagates to BullMQ retry; the waiting-depth and
 *   memory samplers swallow their own errors (logged at warn). Stalled jobs are logged at warn.
 * - **Side effects:** Sentry warnings + logs when any DLQ exceeds `DLQ_DEPTH_WARN_THRESHOLD`,
 *   a source queue exceeds `QUEUE_WAITING_DEPTH_WARN_THRESHOLD`, or the Redis memory ratio
 *   crosses `REDIS_MEMORY_WARN_RATIO` / `REDIS_MEMORY_CRITICAL_RATIO`.
 * - **Notes:** repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createDlqDepthWorker(): WorkerHandle {
  const worker = new Worker(
    DLQ_DEPTH_QUEUE_NAME,
    async () => {
      const result = await sampleDeadLetterQueueDepths();
      const waitingDepth = await sampleBullMqSourceQueueWaitingDepth();
      const memory = await sampleRedisMemorySaturation();
      logger.info(
        {
          queueCount: result.depths.length,
          waitingQueueCount: waitingDepth.depths.length,
          redisMemoryRatio: memory.ratio,
        },
        'queue.dlq.depth.sample.completed',
      );
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: 1,
      ...getDefaultWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queueName: DLQ_DEPTH_QUEUE_NAME }, 'queue.dlq.depth.stalled');
  });

  return buildWorkerHandle(worker, DLQ_DEPTH_QUEUE_NAME);
}
