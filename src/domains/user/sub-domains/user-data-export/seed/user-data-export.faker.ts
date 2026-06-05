/**
 * Faker generators for the user-data-export bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Terminal/non-terminal export statuses allowed by `user_data_exports_status_check`. */
export type DataExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Generated row content for `auth.user_data_exports` (timestamps/keys depend on `status`). */
export interface BulkDataExportProfile {
  /** Job lifecycle status. */
  status: DataExportStatus;
  /** S3 artifact key (only set when `status === 'completed'`). */
  s3_key: string | null;
  /** Artifact expiry (only set when `status === 'completed'`). */
  expires_at: Date | null;
  /** Completion timestamp (only set when `status === 'completed'`). */
  completed_at: Date | null;
  /** Failure timestamp (only set when `status === 'failed'`). */
  failed_at: Date | null;
  /** Failure code (only set when `status === 'failed'`). */
  error_code: string | null;
}

const COMPLETED_OR_FAILED: DataExportStatus[] = ['completed', 'completed', 'failed'];

/**
 * Builds a terminal (completed/failed) export profile. The seeder reserves the non-terminal
 * `pending` status for the deliberate edge-case row so the per-user pending partial-unique index
 * is never violated.
 */
export function generateBulkDataExport(faker: Faker): BulkDataExportProfile {
  const status = faker.helpers.arrayElement(COMPLETED_OR_FAILED);
  if (status === 'completed') {
    const completedAt = faker.date.recent({ days: 30 });
    const expiresAt = new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      status,
      s3_key: `exports/${faker.string.uuid()}.zip`,
      expires_at: expiresAt,
      completed_at: completedAt,
      failed_at: null,
      error_code: null,
    };
  }
  return {
    status: 'failed',
    s3_key: null,
    expires_at: null,
    completed_at: null,
    failed_at: faker.date.recent({ days: 30 }),
    error_code: faker.helpers.arrayElement(['EXPORT_TIMEOUT', 'STORAGE_UNAVAILABLE']),
  };
}
