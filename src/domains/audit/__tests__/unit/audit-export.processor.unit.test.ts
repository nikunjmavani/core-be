import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    AUDIT_EXPORT_ENABLED: false,
    S3_BUCKET: undefined,
    AUDIT_EXPORT_S3_PREFIX: 'audit/export',
    AUDIT_EXPORT_BATCH_SIZE: 1000,
  },
}));

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    selectDistinct: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('@/infrastructure/storage/storage.service.js', () => ({
  headObject: vi.fn(),
  putObjectBuffer: vi.fn(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('audit-export.processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when export is disabled', async () => {
    const { runAuditExportJob } = await import('@/domains/audit/workers/audit-export.processor.js');
    const mockDatabaseHandle = {
      selectDistinct: vi.fn(),
      select: vi.fn(),
    };
    const result = await runAuditExportJob(
      mockDatabaseHandle as unknown as RequestScopedPostgresDatabase,
    );
    expect(result).toEqual({ exportedOrganizations: 0, skipped: 0 });
  });
});
