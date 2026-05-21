import { gzipSync } from 'node:zlib';
import type { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import type { UserDataExportJobData } from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.job.schema.js';
import { UserDataExportCancelledError } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import { runUserScopedWorkerJob } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export async function runUserDataExportJob(
  jobData: UserDataExportJobData,
  userDataExportService: UserDataExportService,
): Promise<void> {
  const { exportPublicId, userPublicId, userInternalId } = jobData;

  return runUserScopedWorkerJob(
    { userPublicId, exportPublicId, userInternalId },
    async (databaseHandle) => {
      try {
        const cancelledBeforeStart = await userDataExportService.isExportJobCancelled(
          exportPublicId,
          userInternalId,
          databaseHandle,
        );
        if (cancelledBeforeStart) {
          logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.cancelled');
          return;
        }

        await userDataExportService.markProcessing(exportPublicId, userInternalId, databaseHandle);

        if (
          await userDataExportService.isExportJobCancelled(
            exportPublicId,
            userInternalId,
            databaseHandle,
          )
        ) {
          logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.cancelled');
          return;
        }

        const payload = await userDataExportService.buildExportPayload(
          userPublicId,
          databaseHandle,
        );
        const jsonBody = JSON.stringify(payload);
        const compressedBody = gzipSync(Buffer.from(jsonBody, 'utf8'));

        await userDataExportService.completeExportJob(
          {
            exportPublicId,
            userInternalId,
            body: compressedBody,
          },
          databaseHandle,
        );

        logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.completed');
      } catch (error) {
        if (error instanceof UserDataExportCancelledError) {
          logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.cancelled');
          return;
        }
        logger.error({ error, exportPublicId, userPublicId }, 'user-data-export.worker.failed');
        await userDataExportService.failExportJob(
          exportPublicId,
          userInternalId,
          'export_failed',
          databaseHandle,
        );
        throw error;
      }
    },
  );
}
