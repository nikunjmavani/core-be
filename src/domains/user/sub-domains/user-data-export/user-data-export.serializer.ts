import type { UserDataExportOutput } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import type { UserDataExportRow } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';

export function serializeUserDataExport(
  row: UserDataExportRow,
  options?: { download_url?: string | null },
): UserDataExportOutput {
  return {
    export_id: row.public_id,
    status: row.status as UserDataExportOutput['status'],
    download_url: options?.download_url ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    failed_at: row.failed_at?.toISOString() ?? null,
    error_code: row.error_code,
    created_at: row.created_at.toISOString(),
  };
}
