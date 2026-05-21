import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runOrganizationApiKeyTombstoneRetentionJob } from '@/domains/tenancy/sub-domains/organization/organization-api-key/workers/organization-api-key-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME } from './organization-api-key-tombstone-retention.constants.js';

/** Hard-delete API keys tombstoned longer than TOMBSTONE_RETENTION_DAYS. */
export function createOrganizationApiKeyTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runOrganizationApiKeyTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME },
      'organization-api-key-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_QUEUE_NAME);
}
