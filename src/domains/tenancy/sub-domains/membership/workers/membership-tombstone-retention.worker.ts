import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runMembershipTombstoneRetentionJob } from '@/domains/tenancy/sub-domains/membership/workers/membership-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME } from './membership-tombstone-retention.constants.js';

/** Hard-delete memberships tombstoned longer than TOMBSTONE_RETENTION_DAYS. */
export function createMembershipTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runMembershipTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME },
      'membership-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, MEMBERSHIP_TOMBSTONE_RETENTION_QUEUE_NAME);
}
