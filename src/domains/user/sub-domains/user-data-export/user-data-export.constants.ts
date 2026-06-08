import { SEVEN_DAYS } from '@/shared/constants/ttl.constants.js';

/** S3 key prefix for GDPR export artifacts. */
export const USER_DATA_EXPORT_S3_PREFIX = 'user-data-export';

/** Days until export row / object expiry (S3 lifecycle should align). */
export const USER_DATA_EXPORT_ARTIFACT_TTL_DAYS = SEVEN_DAYS;

/**
 * Keyset page size for offboarding S3 object deletion (sec-r4-R2). Mirrors the
 * `UPLOAD_OFFBOARDING_DELETE_BATCH_SIZE` pattern in the upload domain so a
 * user with a long export history doesn't load every row into memory at once.
 * Export rows are infrequent in normal use; 500 paginates a worst-case bulk
 * accumulation comfortably.
 */
export const USER_DATA_EXPORT_OFFBOARDING_DELETE_BATCH_SIZE = 500;

/**
 * Max concurrent S3 `deleteObject` calls per batch during offboarding fan-out
 * (sec-r4-R2). Matches `UPLOAD_OFFBOARDING_DELETE_CONCURRENCY` so both
 * offboarding paths exert the same upper bound on outbound S3 throughput
 * per user.
 */
export const USER_DATA_EXPORT_OFFBOARDING_DELETE_CONCURRENCY = 10;
