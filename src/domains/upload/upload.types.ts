import type { UploadPurpose, UploadTarget } from './upload.constants.js';

/** Validated payload accepted by {@link UploadService.createUpload}; mirrors {@link createUploadDto}. */
export interface CreateUploadInput {
  purpose: UploadPurpose;
  for: UploadTarget;
  organizationId?: string;
  contentType: string;
  fileName: string;
  fileSize: number;
}

/**
 * Response body returned by `POST /api/v1/uploads` — presigned URL plus final attach key and
 * expiry metadata.
 */
export interface UploadCreateOutput {
  publicId: string;
  uploadUrl: string;
  /** Final storage key to pass to attach endpoints after `POST /confirm` succeeds. */
  key: string;
  expiresAt: string;
  /**
   * Upload method. `PUT` → send the file as the body to `uploadUrl`. `POST` → submit a
   * multipart form to `uploadUrl` with `fields` plus the file (S3 enforces content-length-range).
   */
  uploadMethod: 'PUT' | 'POST';
  /** Present only for `POST` uploads: hidden form fields to submit alongside the file. */
  fields?: Record<string, string>;
}

/** Response body for the upload metadata endpoints (`GET`, `POST /confirm`). */
export interface UploadDetailOutput {
  publicId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  storageProvider: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}
