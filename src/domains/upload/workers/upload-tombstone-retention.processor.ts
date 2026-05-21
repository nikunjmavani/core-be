import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { deleteObject } from '@/infrastructure/storage/storage.service.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

const PURGE_BATCH_SIZE = 500;

export async function runUploadTombstoneRetentionJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<{
  deletedCount: number;
}> {
  const retentionDays = env.TOMBSTONE_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(
    { retentionDays, cutoffDate: cutoffDate.toISOString() },
    'upload-tombstone-retention.starting',
  );

  let deletedCount = 0;

  for (;;) {
    const batch = await databaseHandle
      .select({ id: uploads.id, file_key: uploads.file_key })
      .from(uploads)
      .where(and(isNotNull(uploads.deleted_at), lt(uploads.deleted_at, cutoffDate)))
      .limit(PURGE_BATCH_SIZE);

    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      const objectDeleted = await deleteObject(row.file_key);
      if (!objectDeleted) {
        logger.warn(
          { uploadId: row.id, fileKey: row.file_key },
          'upload-tombstone-retention.s3ObjectDeleteFailed',
        );
      }
    }

    const identifiers = batch.map((row) => row.id);
    await databaseHandle.delete(uploads).where(inArray(uploads.id, identifiers));
    deletedCount += batch.length;

    if (batch.length < PURGE_BATCH_SIZE) {
      break;
    }
  }

  logger.info({ deletedCount, retentionDays }, 'upload-tombstone-retention.completed');

  return { deletedCount };
}
