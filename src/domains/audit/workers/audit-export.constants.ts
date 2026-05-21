/** BullMQ queue for daily audit log export to S3 (NDJSON gzip per organization). */
export const AUDIT_EXPORT_QUEUE_NAME = 'audit-export';

export const AUDIT_EXPORT_MANIFEST_FILENAME = 'manifest.json';
export const AUDIT_EXPORT_SCHEMA_VERSION = '1' as const;

export interface AuditExportManifestObject {
  key: string;
  row_count: number;
  sha256: string;
  format: 'ndjson';
  content_type: 'application/gzip';
}

export interface AuditExportManifest {
  schema_version: typeof AUDIT_EXPORT_SCHEMA_VERSION;
  export_date: string;
  organization_id: number;
  objects: AuditExportManifestObject[];
}
