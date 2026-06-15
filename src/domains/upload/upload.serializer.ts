import type { UploadRow } from './upload.repository.js';
import type { UploadCreateOutput, UploadDetailOutput } from './upload.types.js';

/**
 * Shapes the `POST /api/v1/uploads` response from the presigned URL flow,
 * normalizing `expiresAt` to an ISO string and including the multipart
 * `fields` map only for `POST`-method (presigned-post) uploads.
 */
export function serializeUploadCreate(data: {
  id: string;
  uploadUrl: string;
  key: string;
  expiresAt: Date;
  uploadMethod: 'PUT' | 'POST';
  fields?: Record<string, string>;
}): UploadCreateOutput {
  return {
    id: data.id,
    uploadUrl: data.uploadUrl,
    key: data.key,
    expiresAt: data.expiresAt.toISOString(),
    uploadMethod: data.uploadMethod,
    ...(data.fields !== undefined ? { fields: data.fields } : {}),
  };
}

/**
 * Shapes an {@link UploadRow} for the upload detail endpoints; replaces the
 * internal `organization_id` foreign key with the caller-visible
 * organization public id (resolved by {@link UploadService}).
 */
export function serializeUploadDetail(
  row: UploadRow,
  organizationPublicId: string | null,
): UploadDetailOutput {
  // `file_key` (the internal S3 object path) and `bucket` are deliberately NOT
  // serialized — they are storage-internal, the client uses presigned URLs and
  // never the raw key, and exposing them reveals storage layout for enumeration.
  return {
    id: row.public_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    status: row.status,
    storageProvider: row.storage_provider,
    organizationId: organizationPublicId,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
