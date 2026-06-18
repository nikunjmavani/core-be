import type { UploadRow } from './upload.repository.js';
import type { UploadCreateOutput, UploadDetailOutput } from './upload.types.js';

/**
 * Shapes the `POST /api/v1/uploads` response from the presigned URL flow,
 * normalizing `expires_at` to an ISO string and including the multipart
 * `fields` map only for `POST`-method (presigned-post) uploads.
 */
export function serializeUploadCreate(data: {
  id: string;
  upload_url: string;
  key: string;
  expires_at: Date;
  upload_method: 'PUT' | 'POST';
  fields?: Record<string, string>;
}): UploadCreateOutput {
  return {
    id: data.id,
    upload_url: data.upload_url,
    key: data.key,
    expires_at: data.expires_at.toISOString(),
    upload_method: data.upload_method,
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
  organization_public_id: string | null,
): UploadDetailOutput {
  // `file_key` (the internal S3 object path) and `bucket` are deliberately NOT
  // serialized — they are storage-internal, the client uses presigned URLs and
  // never the raw key, and exposing them reveals storage layout for enumeration.
  return {
    id: row.public_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    status: row.status,
    storage_provider: row.storage_provider,
    organization_id: organization_public_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
