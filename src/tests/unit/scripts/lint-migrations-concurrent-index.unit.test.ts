import { describe, it, expect } from 'vitest';
import { lintMigrationFileContent } from '@/scripts/validators/migration/lint-migrations.js';

describe('lint-migrations: concurrent_index_requires_non_transactional', () => {
  it('flags CREATE INDEX CONCURRENTLY without a non-transactional header', () => {
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_created ON audit.logs (created_at);
`;
    const { violations } = lintMigrationFileContent('20990101000001_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'concurrent_index_requires_non_transactional',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.lineNumber).toBe(1);
  });

  it('passes when the migration is marked non-transactional', () => {
    const sql = `-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_created ON audit.logs (created_at);
`;
    const { violations, headerErrors } = lintMigrationFileContent('20990101000002_test.sql', sql);
    expect(headerErrors).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('cannot be suppressed by the -- migration-safety: allow header', () => {
    const sql = `-- migration-safety: allow concurrent_index_requires_non_transactional reason="trying to escape"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_created ON audit.logs (created_at);
`;
    const { violations, headerErrors } = lintMigrationFileContent('20990101000003_test.sql', sql);
    expect(headerErrors).toEqual([]);
    expect(
      violations.some(
        (violation) => violation.ruleId === 'concurrent_index_requires_non_transactional',
      ),
    ).toBe(true);
  });

  it('surfaces malformed migration-transaction headers as header errors', () => {
    const sql = `-- migration-transaction: none
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_created ON audit.logs (created_at);
`;
    const { headerErrors } = lintMigrationFileContent('20990101000004_test.sql', sql);
    expect(headerErrors.length).toBeGreaterThan(0);
    expect(headerErrors[0]).toContain('migration-transaction');
  });

  it('still flags plain CREATE INDEX in a non-transactional migration', () => {
    const sql = `-- migration-transaction: none reason="batch of concurrent index builds"
CREATE INDEX IF NOT EXISTS idx_logs_created ON audit.logs (created_at);
`;
    const { violations } = lintMigrationFileContent('20990101000005_test.sql', sql);
    expect(
      violations.some((violation) => violation.ruleId === 'create_index_without_concurrently'),
    ).toBe(true);
    expect(
      violations.some(
        (violation) => violation.ruleId === 'concurrent_index_requires_non_transactional',
      ),
    ).toBe(false);
  });
});
