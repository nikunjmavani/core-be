import type { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import type { UserDataExportJobData } from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.job.schema.js';
import { UserDataExportCancelledError } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import { runUserScopedWorkerJob } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { gzipBufferAsync } from '@/shared/utils/infrastructure/gzip.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Execute one `user-data-export` job inside `withUserDatabaseContext` so RLS attributes the cross-
 * domain reads to the requesting user.
 *
 * @remarks
 * - **Algorithm:** check cancellation → mark `processing` → re-check cancellation → build the
 *   GDPR payload, gzip, upload to S3 → flip status to `completed`. Each cancellation check covers
 *   the user being soft-deleted or the export row being purged by offboarding.
 * - **Failure modes:** {@link UserDataExportCancelledError} short-circuits to a no-op (no retry,
 *   no failure status). All other errors are logged, mark the row `failed` with `error_code`
 *   `export_failed`, and re-throw so BullMQ applies the queue's retry/backoff and DLQ policy.
 * - **Side effects:** writes `auth.user_data_exports` status, uploads a gzip JSON object to the
 *   GDPR S3 prefix, and emits structured logs for observability.
 * - **Notes:** runs inside the user-scoped DB context; cross-domain reads delegate to each
 *   owning domain's service (see dependency rules).
 */
export async function runUserDataExportJob(
  jobData: UserDataExportJobData,
  userDataExportService: UserDataExportService,
): Promise<void> {
  const { exportPublicId, userPublicId, userInternalId } = jobData;

  return runUserScopedWorkerJob(
    { userPublicId, exportPublicId, userInternalId },
    async (databaseHandle) => {
      try {
        const cancelledBeforeStart = await userDataExportService.isExportJobCancelled({
          exportPublicId,
          userInternalId,
          userPublicId,
          databaseHandle,
        });
        if (cancelledBeforeStart) {
          logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.cancelled');
          return;
        }

        await userDataExportService.markProcessing(
          exportPublicId,
          userInternalId,
          databaseHandle,
          userPublicId,
        );

        if (
          await userDataExportService.isExportJobCancelled({
            exportPublicId,
            userInternalId,
            userPublicId,
            databaseHandle,
          })
        ) {
          logger.info({ exportPublicId, userPublicId }, 'user-data-export.worker.cancelled');
          return;
        }

        const payload = await userDataExportService.buildExportPayload(userPublicId);
        const jsonBody = JSON.stringify(payload);
        const compressedBody = await gzipBufferAsync(Buffer.from(jsonBody, 'utf8'));

        await userDataExportService.completeExportJob(
          {
            exportPublicId,
            userInternalId,
            userPublicId,
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
