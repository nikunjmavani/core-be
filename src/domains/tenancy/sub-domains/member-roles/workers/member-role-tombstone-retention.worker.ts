import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runMemberRoleTombstoneRetentionJob } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME } from './member-role-tombstone-retention.constants.js';

/**
 * Hard-delete roles tombstoned longer than TOMBSTONE_RETENTION_DAYS.
 * tenancy.role_permissions rows cascade via FK ON DELETE CASCADE.
 */
export function createMemberRoleTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runMemberRoleTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME },
      'member-role-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, MEMBER_ROLE_TOMBSTONE_RETENTION_QUEUE_NAME);
}
