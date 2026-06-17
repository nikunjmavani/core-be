import type { UploadPurpose, UploadTarget } from './upload.constants.js';

/** Validated payload accepted by {@link UploadService.createUpload}; mirrors {@link createUploadDto}. */
export interface CreateUploadInput {
  purpose: UploadPurpose;
  for: UploadTarget;
  organization_id?: string;
  content_type: string;
  file_name: string;
  file_size: number;
}

/**
 * Response body returned by `POST /api/v1/uploads` — presigned URL plus final attach key and
 * expiry metadata.
 */
export interface UploadCreateOutput {
  id: string;
  upload_url: string;
  /** Final storage key to pass to attach endpoints after `POST /confirm` succeeds. */
  key: string;
  expires_at: string;
  /**
   * Upload method. `PUT` → send the file as the body to `upload_url`. `POST` → submit a
   * multipart form to `upload_url` with `fields` plus the file (S3 enforces content-length-range).
   */
  upload_method: 'PUT' | 'POST';
  /** Present only for `POST` uploads: hidden form fields to submit alongside the file. */
  fields?: Record<string, string>;
}

/** Response body for the upload metadata endpoints (`GET`, `POST /confirm`). */
export interface UploadDetailOutput {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  status: string;
  storage_provider: string;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}
