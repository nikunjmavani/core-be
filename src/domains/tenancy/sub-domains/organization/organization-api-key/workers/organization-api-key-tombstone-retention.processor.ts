import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runOrganizationApiKeyTombstoneRetentionJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<{
  deletedCount: number;
  blockedCount: number;
}> {
  const retentionDays = env.TOMBSTONE_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(
    { retentionDays, cutoffDate: cutoffDate.toISOString() },
    'organization-api-key-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: api_keys,
    idColumn: api_keys.id,
    whereCondition: and(isNotNull(api_keys.deleted_at), lt(api_keys.deleted_at, cutoffDate))!,
    logContext: 'organization-api-key-tombstone-retention',
    tableLabel: 'tenancy.api_keys',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'organization-api-key-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
