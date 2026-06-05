import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import {
  findPendingUploadsOlderThan,
  hardDeleteUploadsByInternalIds,
  setUploadStatusByInternalId,
  type PendingUploadSweepRow,
} from '@/domains/upload/upload.repository.js';
import {
  deleteObject,
  getObjectLeadingBytes,
  headObject,
} from '@/infrastructure/storage/storage.service.js';
import { PRESIGNED_URL_EXPIRY_SECONDS } from '@/shared/constants/ttl.constants.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  isMagicByteVerifiable,
  verifyFileMagicBytes,
} from '@/shared/utils/validation/file-magic.util.js';
import { UPLOAD_PENDING_SWEEP_BATCH_SIZE } from './upload-pending-sweep.constants.js';
import { isSvgContentType } from '@/domains/upload/utils/upload-svg.util.js';

/**
 * Outcome counters for one {@link runUploadPendingSweepJob} run.
 *
 * @remarks
 * - **scannedCount:** stale PENDING rows considered in this batch.
 * - **autoConfirmedCount:** rows whose S3 object existed with a matching
 *   length/content-type and were transitioned to `UPLOADED`.
 * - **failedCount:** rows whose S3 object existed but with metadata mismatch;
 *   transitioned to `FAILED` so they can never be attached.
 * - **deletedCount:** orphan rows whose S3 object was missing; hard-deleted
 *   after a best-effort S3 delete.
 */
export type UploadPendingSweepResult = {
  scannedCount: number;
  autoConfirmedCount: number;
  failedCount: number;
  deletedCount: number;
};

/**
 * Reconciles stale PENDING uploads — clients that obtained a presigned URL but never
 * called confirm. For each candidate row past the grace window:
 *
 * - Object exists with matching size  → mark UPLOADED (auto-confirm).
 * - Object exists with mismatched size → mark FAILED (will not be attachable).
 * - Object missing                    → hard-delete the orphan row (idempotent S3 delete first).
 *
 * Runs under withGlobalRetentionCleanupDatabaseContext so RLS does not block cross-tenant rows.
 *
 * @remarks
 * - **Algorithm:** cutoff = now − (`PRESIGNED_URL_EXPIRY_SECONDS` +
 *   `UPLOAD_PENDING_SWEEP_GRACE_SECONDS`). Selects up to
 *   {@link UPLOAD_PENDING_SWEEP_BATCH_SIZE} oldest PENDING rows older than
 *   the cutoff, HEADs each S3 object, and applies the verdict (auto-confirm,
 *   fail, or orphan-delete) in a single pass.
 * - **Failure modes:** transient S3 errors during HEAD or DELETE are logged
 *   at `warn` and the row is left for the next sweep (no row is hard-deleted
 *   unless the object was confirmed missing). Repository errors bubble to
 *   BullMQ for retry.
 * - **Side effects:** updates `upload.uploads` status, deletes orphan rows,
 *   and may delete leftover S3 objects. No events emitted.
 * - **Notes:** batch-scoped — large backlogs drain over multiple repeats.
 *   Caller (worker) supplies the database handle from the global-retention
 *   context so RLS does not filter cross-tenant rows.
 */
export async function runUploadPendingSweepJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<UploadPendingSweepResult> {
  const graceSeconds = env.UPLOAD_PENDING_SWEEP_GRACE_SECONDS;
  const cutoffMs = Date.now() - (PRESIGNED_URL_EXPIRY_SECONDS + graceSeconds) * 1000;
  const cutoffDate = new Date(cutoffMs);

  const rows = await findPendingUploadsOlderThan(
    databaseHandle,
    cutoffDate,
    UPLOAD_PENDING_SWEEP_BATCH_SIZE,
  );

  logger.info(
    {
      scannedCount: rows.length,
      cutoffDate: cutoffDate.toISOString(),
      graceSeconds,
      batchSize: UPLOAD_PENDING_SWEEP_BATCH_SIZE,
    },
    'upload-pending-sweep.starting',
  );

  let autoConfirmedCount = 0;
  let failedCount = 0;
  const idsToHardDelete: number[] = [];

  for (const row of rows) {
    const verdict = await resolvePendingUploadVerdict(row);
    if (verdict === 'auto_confirm') {
      await setUploadStatusByInternalId(databaseHandle, row.id, 'UPLOADED');
      autoConfirmedCount += 1;
      logger.info(
        { uploadId: row.id, fileKey: row.file_key },
        'upload-pending-sweep.autoConfirmed',
      );
    } else if (verdict === 'fail') {
      await setUploadStatusByInternalId(databaseHandle, row.id, 'FAILED');
      failedCount += 1;
      logger.warn(
        { uploadId: row.id, fileKey: row.file_key },
        'upload-pending-sweep.metadataMismatch',
      );
    } else {
      // Object missing — remove any leftover S3 byte (idempotent) and queue the DB delete.
      const deleted = await deleteObject(row.file_key);
      if (!deleted) {
        logger.warn(
          { uploadId: row.id, fileKey: row.file_key },
          'upload-pending-sweep.s3DeleteFailed',
        );
      }
      idsToHardDelete.push(row.id);
    }
  }

  const deletedCount = await hardDeleteUploadsByInternalIds(databaseHandle, idsToHardDelete);

  logger.info(
    { scannedCount: rows.length, autoConfirmedCount, failedCount, deletedCount },
    'upload-pending-sweep.completed',
  );

  return {
    scannedCount: rows.length,
    autoConfirmedCount,
    failedCount,
    deletedCount,
  };
}

type PendingUploadVerdict = 'auto_confirm' | 'fail' | 'orphan';

async function resolvePendingUploadVerdict(
  row: PendingUploadSweepRow,
): Promise<PendingUploadVerdict> {
  // sec-UP2: the sweep would auto-confirm SVG by setting status=UPLOADED
  // WITHOUT running the publish path that DOMPurifies SVG bytes and copies
  // them off the pending (still client-writable) key. Refuse to auto-
  // confirm SVG; the user must explicitly call confirm (which DOES go
  // through publishConfirmedObject + sanitizer + pending→final copy).
  if (isSvgContentType(row.mime_type)) {
    return 'fail';
  }
  const metadata = await headObject(row.file_key);
  if (metadata?.contentLength === undefined) {
    return 'orphan';
  }
  const lengthMatches = metadata.contentLength === row.file_size;
  // S3 may not echo a content-type; only fail on type when one is reported.
  const typeMatches = metadata.contentType === undefined || metadata.contentType === row.mime_type;
  if (!(lengthMatches && typeMatches)) {
    return 'fail';
  }
  if (isMagicByteVerifiable(row.mime_type)) {
    try {
      const object = await getObjectLeadingBytes(row.file_key);
      if (object === null || !verifyFileMagicBytes(object.body, row.mime_type)) {
        return 'fail';
      }
    } catch (error) {
      logger.warn(
        { uploadId: row.id, fileKey: row.file_key, error },
        'upload-pending-sweep.magicByteVerifyFailed',
      );
      return 'fail';
    }
  }
  return 'auto_confirm';
}
