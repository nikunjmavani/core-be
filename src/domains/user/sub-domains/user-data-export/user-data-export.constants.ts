import { SEVEN_DAYS } from '@/shared/constants/ttl.constants.js';

/** S3 key prefix for GDPR export artifacts. */
export const USER_DATA_EXPORT_S3_PREFIX = 'user-data-export';

/** Days until export row / object expiry (S3 lifecycle should align). */
export const USER_DATA_EXPORT_ARTIFACT_TTL_DAYS = SEVEN_DAYS;
