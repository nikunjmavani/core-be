import { describe, it, expect } from 'vitest';
import { lintMigrationFileContent } from '@/scripts/validators/migration/lint-migrations.js';

describe('lint-migrations: disable_row_security_guc', () => {
  it('flags a top-level SET row_security = off statement', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.foo (id BIGINT);
SET row_security = off;
`;
    const { violations } = lintMigrationFileContent('20990101000001_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'disable_row_security_guc',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.lineNumber).toBe(2);
  });

  it('flags SET LOCAL row_security and SET SESSION row_security', () => {
    const sql = `SET LOCAL row_security = off;
SET SESSION row_security TO off;
`;
    const { violations } = lintMigrationFileContent('20990101000002_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'disable_row_security_guc',
    );
    expect(matched.map((violation) => violation.lineNumber)).toEqual([1, 2]);
  });

  it('flags RESET row_security', () => {
    const sql = `RESET row_security;
`;
    const { violations } = lintMigrationFileContent('20990101000003_test.sql', sql);
    expect(violations.some((violation) => violation.ruleId === 'disable_row_security_guc')).toBe(
      true,
    );
  });

  it('flags row_security GUC used as a CREATE FUNCTION attribute', () => {
    const sql = `CREATE OR REPLACE FUNCTION public.lookup_thing()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT TRUE;
$$;
`;
    const { violations } = lintMigrationFileContent('20990101000004_test.sql', sql);
    const matched = violations.filter(
      (violation) => violation.ruleId === 'disable_row_security_guc',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.lineNumber).toBe(6);
  });

  it('cannot be suppressed by the -- migration-safety: allow header', () => {
    const sql = `-- migration-safety: allow disable_row_security_guc reason="trying to escape the ban"
SET row_security = off;
`;
    const { violations, headerErrors } = lintMigrationFileContent('20990101000005_test.sql', sql);
    expect(headerErrors).toEqual([]);
    expect(violations.some((violation) => violation.ruleId === 'disable_row_security_guc')).toBe(
      true,
    );
  });

  it('ignores occurrences inside SQL comments', () => {
    const sql = `-- historical note: an earlier draft used SET row_security = off here
CREATE TABLE IF NOT EXISTS public.bar (id BIGINT);
`;
    const { violations } = lintMigrationFileContent('20990101000006_test.sql', sql);
    expect(violations.some((violation) => violation.ruleId === 'disable_row_security_guc')).toBe(
      false,
    );
  });

  it('does not match unrelated SET statements', () => {
    const sql = `SET search_path = public;
SET LOCAL statement_timeout = '10s';
SET TIME ZONE 'UTC';
`;
    const { violations } = lintMigrationFileContent('20990101000007_test.sql', sql);
    expect(violations.some((violation) => violation.ruleId === 'disable_row_security_guc')).toBe(
      false,
    );
  });
});
