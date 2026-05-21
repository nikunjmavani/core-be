import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  lintMigrationRollbackPairing,
  lintMigrationsDirectory,
  parseMigrationRollbackHeader,
} from '@/scripts/validators/migration/lint-migrations.js';

const fixturesRoot = resolve(process.cwd(), 'src/tests/fixtures/migration-rollback-lint');

describe('lint-migrations rollback pairing', () => {
  it('parseMigrationRollbackHeader accepts requires-down with reason', () => {
    const header = parseMigrationRollbackHeader(
      '-- migration-rollback: requires down reason="Neon branch rehearsal"\n',
    );
    expect(header.requiresDown).toBe(true);
    expect(header.headerErrors).toEqual([]);
  });

  it('parseMigrationRollbackHeader rejects requires-down without reason', () => {
    const header = parseMigrationRollbackHeader('-- migration-rollback: requires down reason=""\n');
    expect(header.requiresDown).toBe(false);
    expect(header.headerErrors.length).toBeGreaterThan(0);
  });

  it('lintMigrationRollbackPairing flags missing .down.sql when required', async () => {
    const folder = resolve(fixturesRoot, 'broken-missing-down');
    const result = await lintMigrationsDirectory(folder);
    expect(
      result.rollbackViolations.some((v) => v.ruleId === 'missing_required_down_migration'),
    ).toBe(true);
  });

  it('lintMigrationRollbackPairing accepts valid up/down pair', async () => {
    const folder = resolve(fixturesRoot, 'valid-pair');
    const result = await lintMigrationsDirectory(folder);
    expect(result.rollbackViolations).toEqual([]);
  });

  it('lintMigrationRollbackPairing flags orphan .down.sql', () => {
    const folder = resolve(fixturesRoot, 'orphan-down');
    const violations = lintMigrationRollbackPairing(
      folder,
      [],
      new Map([['20260101000003_orphan.down.sql', 'SELECT 1;']]),
    );
    expect(violations.some((v) => v.ruleId === 'orphan_down_migration')).toBe(true);
  });
});
