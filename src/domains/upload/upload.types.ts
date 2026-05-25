import type { UploadPurpose, UploadTarget } from './upload.constants.js';

export interface CreateUploadInput {
  purpose: UploadPurpose;
  for: UploadTarget;
  organizationId?: string;
  contentType: string;
  fileName: string;
  fileSize: number;
}

export interface UploadCreateOutput {
  publicId: string;
  uploadUrl: string;
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

export interface UploadDetailOutput {
  publicId: string;
  fileName: string;
  fileKey: string;
  mimeType: string;
  fileSize: number;
  status: string;
  storageProvider: string;
  bucket: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}
