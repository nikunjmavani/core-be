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
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_id ON auth.users (created_at, id);
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

describe('lint-migrations: non_transactional_statements_need_breakpoints', () => {
  it('flags multiple statements in a non-transactional migration without breakpoints', () => {
    const sql = `-- migration-transaction: none reason="concurrent index builds"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_a ON audit.logs (a);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b ON audit.logs (b);
`;
    const { violations } = lintMigrationFileContent('20990101000010_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'non_transactional_statements_need_breakpoints',
    );
    expect(matched).toHaveLength(1);
  });

  it('passes when each statement is separated by --> statement-breakpoint', () => {
    const sql = `-- migration-transaction: none reason="concurrent index builds"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_a ON audit.logs (a);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b ON audit.logs (b);
`;
    const { violations, headerErrors } = lintMigrationFileContent('20990101000011_test.sql', sql);
    expect(headerErrors).toEqual([]);
    expect(
      violations.some(
        (violation) => violation.ruleId === 'non_transactional_statements_need_breakpoints',
      ),
    ).toBe(false);
  });

  it('does not flag a single-statement non-transactional migration', () => {
    const sql = `-- migration-transaction: none reason="single concurrent index build"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_a ON audit.logs (a);
`;
    const { violations } = lintMigrationFileContent('20990101000012_test.sql', sql);
    expect(
      violations.some(
        (violation) => violation.ruleId === 'non_transactional_statements_need_breakpoints',
      ),
    ).toBe(false);
  });

  it('does not flag multi-statement transactional migrations (default lane)', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.a (id BIGINT);
CREATE TABLE IF NOT EXISTS public.b (id BIGINT);
`;
    const { violations } = lintMigrationFileContent('20990101000013_test.sql', sql);
    expect(
      violations.some(
        (violation) => violation.ruleId === 'non_transactional_statements_need_breakpoints',
      ),
    ).toBe(false);
  });
});
