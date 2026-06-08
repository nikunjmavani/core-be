import { describe, it, expect } from 'vitest';
import { lintMigrationFileContent } from '@/scripts/validators/migration/lint-migrations.js';

/**
 * sec-r4-D5 recurrence prevention: DROP INDEX without CONCURRENTLY inside a
 * transactional migration takes an ACCESS EXCLUSIVE lock for the duration of
 * the file's transaction, blocking writers on the parent table. Force callers
 * to move the drop into a non-transactional migration with
 * `DROP INDEX CONCURRENTLY IF EXISTS`.
 */
describe('lint-migrations: drop_index_without_concurrently', () => {
  it('flags plain DROP INDEX in a transactional migration', () => {
    const sql = `DROP INDEX IF EXISTS auth.idx_some_dead_index;
`;
    const { violations } = lintMigrationFileContent('29990101000001_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'drop_index_without_concurrently',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.lineNumber).toBe(1);
  });

  it('passes when DROP INDEX CONCURRENTLY is used in a non-transactional migration', () => {
    const sql = `-- migration-transaction: none reason="DROP INDEX CONCURRENTLY cannot run inside a transaction"
DROP INDEX CONCURRENTLY IF EXISTS auth.idx_some_dead_index;
`;
    const { violations, headerErrors } = lintMigrationFileContent('29990101000002_test.sql', sql);
    expect(headerErrors).toEqual([]);
    expect(
      violations.some((violation) => violation.ruleId === 'drop_index_without_concurrently'),
    ).toBe(false);
  });

  it('does not flag plain DROP INDEX inside a non-transactional migration (autocommit; no held lock)', () => {
    // Non-transactional lane runs each --> statement-breakpoint segment as its
    // own implicit transaction, so a plain DROP INDEX releases its catalog
    // lock immediately. The rule only fires for the transactional lane.
    const sql = `-- migration-transaction: none reason="catalog drops are short and independent"
DROP INDEX IF EXISTS auth.idx_some_dead_index;
`;
    const { violations } = lintMigrationFileContent('29990101000003_test.sql', sql);
    expect(
      violations.some((violation) => violation.ruleId === 'drop_index_without_concurrently'),
    ).toBe(false);
  });

  it('can be opted out per-file with a migration-safety allow header', () => {
    const sql = `-- migration-safety: allow drop_index_without_concurrently reason="documented exception"
DROP INDEX IF EXISTS auth.idx_some_dead_index;
`;
    const { violations, usedAllowRules } = lintMigrationFileContent('29990101000004_test.sql', sql);
    expect(
      violations.some((violation) => violation.ruleId === 'drop_index_without_concurrently'),
    ).toBe(false);
    expect(usedAllowRules.has('drop_index_without_concurrently')).toBe(true);
  });

  it('grandfathers the historical 20260606010000 migration (filename allowlist)', () => {
    // The pre-rule migration that prompted sec-r4-D5 keeps its plain DROP INDEX
    // form — we don't rewrite already-applied migration history. The
    // forward-only fix is the separate 20260608060000_user_notif_prefs_drop_org_index_concurrently.sql
    // that codifies the correct pattern.
    const sql = `DROP INDEX IF EXISTS auth.idx_user_notif_prefs_org;
`;
    const { violations } = lintMigrationFileContent(
      '20260606010000_user_notif_prefs_drop_org_branch.sql',
      sql,
    );
    expect(
      violations.some((violation) => violation.ruleId === 'drop_index_without_concurrently'),
    ).toBe(false);
  });
});
