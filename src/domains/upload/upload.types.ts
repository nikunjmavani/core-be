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
