/** BullMQ queue for daily audit log export to S3 (NDJSON gzip per organization). */
export const AUDIT_EXPORT_QUEUE_NAME = 'audit-export';

/** Filename used for the per-export manifest sidecar uploaded next to the NDJSON parts. */
export const AUDIT_EXPORT_MANIFEST_FILENAME = 'manifest.json';
/** Manifest schema version literal — bump when the manifest shape changes incompatibly. */
export const AUDIT_EXPORT_SCHEMA_VERSION = '1';

/** One uploaded object entry inside an {@link AuditExportManifest} (single NDJSON.gz part). */
export interface AuditExportManifestObject {
  key: string;
  row_count: number;
  sha256: string;
  format: 'ndjson';
  content_type: 'application/gzip';
}

/**
 * Top-level manifest persisted alongside an organization's daily audit export;
 * downstream tooling reads `objects[]` to verify the part files (size, sha256).
 */
export interface AuditExportManifest {
  schema_version: typeof AUDIT_EXPORT_SCHEMA_VERSION;
  export_date: string;
  organization_id: number;
  objects: AuditExportManifestObject[];
}
