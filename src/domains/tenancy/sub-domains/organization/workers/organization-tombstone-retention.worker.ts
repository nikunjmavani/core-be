import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runOrganizationTombstoneRetentionJob } from '@/domains/tenancy/sub-domains/organization/workers/organization-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME } from './organization-tombstone-retention.constants.js';

/**
 * Hard-delete organizations tombstoned longer than TOMBSTONE_RETENTION_DAYS.
 * Child rows with ON DELETE CASCADE are removed with the organization.
 */
export function createOrganizationTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runOrganizationTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME },
      'organization-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, ORGANIZATION_TOMBSTONE_RETENTION_QUEUE_NAME);
}
