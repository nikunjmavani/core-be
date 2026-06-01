import { Worker } from 'bullmq';
import { sampleIdempotencyCardinality } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.service.js';
import { IDEMPOTENCY_CARDINALITY_QUEUE_NAME } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.constants.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Creates the BullMQ worker that drives {@link sampleIdempotencyCardinality}
 * on the repeatable scheduler tick.
 *
 * @remarks
 * - **Algorithm:** one job per tick at `RETENTION_WORKER_CONCURRENCY`; logs the
 *   observed key count and truncation flag on every completion.
 * - **Failure modes:** sampler errors propagate to BullMQ retry then DLQ; stalled
 *   jobs log at warn via the `stalled` listener.
 * - **Side effects:** see {@link sampleIdempotencyCardinality} — Redis SCAN,
 *   counter SET, optional Sentry alerts.
 * - **Notes:** repeatable schedule is registered in
 *   `src/infrastructure/queue/scheduler.ts`.
 */
export function createIdempotencyCardinalityWorker(): WorkerHandle {
  const worker = new Worker(
    IDEMPOTENCY_CARDINALITY_QUEUE_NAME,
    async () => {
      const result = await sampleIdempotencyCardinality();
      logger.info(
        {
          observedCount: result.observedCount,
          scanTruncated: result.scanTruncated,
        },
        'idempotency.cardinality.sample.completed',
      );
      return result;
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: IDEMPOTENCY_CARDINALITY_QUEUE_NAME },
      'idempotency.cardinality.stalled',
    );
  });

  return buildWorkerHandle(worker, IDEMPOTENCY_CARDINALITY_QUEUE_NAME);
}
