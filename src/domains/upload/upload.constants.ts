/** Functional category of an upload — drives key prefix, max size, and allowed MIME types. */
export const UPLOAD_PURPOSES = {
  AVATAR: 'avatar',
  ORGANIZATION_LOGO: 'organization-logo',
  USER_FILE: 'user-file',
  ORGANIZATION_FILE: 'organization-file',
} as const;

/** Union of valid purpose codes from {@link UPLOAD_PURPOSES}. */
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[keyof typeof UPLOAD_PURPOSES];

/** Ownership scope for an upload: belongs to a `user` (private) or an `organization` (org-scoped). */
export const UPLOAD_TARGETS = {
  USER: 'user',
  ORGANIZATION: 'organization',
} as const;

/** Union of valid target codes from {@link UPLOAD_TARGETS}. */
export type UploadTarget = (typeof UPLOAD_TARGETS)[keyof typeof UPLOAD_TARGETS];

/**
 * Upload lifecycle status. Matches the DB CHECK constraint
 * (`status IN ('PENDING','UPLOADED','FAILED')`). Consumers must require `UPLOADED`
 * before attaching an object (e.g. avatar/logo).
 */
export const UPLOAD_STATUS = {
  PENDING: 'PENDING',
  UPLOADED: 'UPLOADED',
  FAILED: 'FAILED',
} as const;

/** Union of valid status codes from {@link UPLOAD_STATUS}. */
export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS];

/**
 * For presigned URL uploads, files go directly to S3 and we never see bytes.
 * When file bytes are available (e.g. server-side upload, S3 Object Lambda),
 * use verifyFileMagicBytes() from @/shared/utils/validation/file-magic.util.js to validate
 * content matches declared content-type.
 */

export interface UploadPurposeConfig {
  allowedTypes: readonly string[];
  maxSize: number;
  keyPrefix: string;
}

/**
 * Per-purpose policy table consulted by the validator and presigned-URL
 * service: allowed MIME types, max byte size, and the S3 key prefix used
 * when constructing object keys.
 */
export const UPLOAD_PURPOSE_CONFIG: Record<UploadPurpose, UploadPurposeConfig> = {
  [UPLOAD_PURPOSES.AVATAR]: {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxSize: 2 * 1024 * 1024, // 2 MB
    keyPrefix: 'avatars',
  },
  [UPLOAD_PURPOSES.ORGANIZATION_LOGO]: {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5 MB
    keyPrefix: 'organization-logos',
  },
  [UPLOAD_PURPOSES.USER_FILE]: {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    maxSize: 10 * 1024 * 1024, // 10 MB
    keyPrefix: 'user-files',
  },
  [UPLOAD_PURPOSES.ORGANIZATION_FILE]: {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    maxSize: 10 * 1024 * 1024, // 10 MB
    keyPrefix: 'organization-files',
  },
} as const;

export { PRESIGNED_URL_EXPIRY_SECONDS } from '@/shared/constants/ttl.constants.js';

/** S3 key prefix for a user's avatar uploads (`avatars/{userPublicId}/...`). */
export function buildUserAvatarKeyPrefix(userPublicId: string): string {
  return `${UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.AVATAR].keyPrefix}/${userPublicId}/`;
}

/** S3 key prefix for an organization's logo uploads (`organization-logos/{organizationPublicId}/...`). */
export function buildOrganizationLogoKeyPrefix(organizationPublicId: string): string {
  return `${UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.ORGANIZATION_LOGO].keyPrefix}/${organizationPublicId}/`;
}
