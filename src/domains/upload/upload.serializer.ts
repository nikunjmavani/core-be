import type { UploadRow } from './upload.repository.js';
import type { UploadCreateOutput, UploadDetailOutput } from './upload.types.js';

export function serializeUploadCreate(data: {
  publicId: string;
  uploadUrl: string;
  key: string;
  expiresAt: Date;
}): UploadCreateOutput {
  return {
    publicId: data.publicId,
    uploadUrl: data.uploadUrl,
    key: data.key,
    expiresAt: data.expiresAt.toISOString(),
  };
}

export function serializeUploadDetail(
  row: UploadRow,
  organizationPublicId: string | null,
): UploadDetailOutput {
  return {
    publicId: row.public_id,
    fileName: row.file_name,
    fileKey: row.file_key,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    status: row.status,
    storageProvider: row.storage_provider,
    bucket: row.bucket,
    organizationId: organizationPublicId,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
