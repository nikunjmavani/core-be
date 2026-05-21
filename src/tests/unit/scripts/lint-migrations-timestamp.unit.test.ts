import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  getMaxMigrationPrefix,
  incrementMigrationPrefix,
  lintMigrationTimestamps,
  suggestNextMigrationPrefix,
} from '@/scripts/validators/migration/lint-migrations.js';

const fixturesRoot = resolve(process.cwd(), 'src/tests/fixtures/migration-timestamp-lint');

describe('lintMigrationTimestamps', () => {
  it('accepts a monotonic valid fixture chain', async () => {
    const { readdir } = await import('node:fs/promises');
    const filenames = (await readdir(resolve(fixturesRoot, 'valid'))).filter((file) =>
      file.endsWith('.sql'),
    );
    const violations = lintMigrationTimestamps(filenames);
    expect(violations.filter((violation) => violation.severity === 'error')).toEqual([]);
  });

  it('reports non-monotonic prefix', async () => {
    const { readdir } = await import('node:fs/promises');
    const filenames = (await readdir(resolve(fixturesRoot, 'invalid-order'))).filter((file) =>
      file.endsWith('.sql'),
    );
    const violations = lintMigrationTimestamps(filenames);
    expect(
      violations.some((violation) => violation.ruleId === 'migration_timestamp_not_monotonic'),
    ).toBe(true);
  });

  it('reports invalid filename format', () => {
    const violations = lintMigrationTimestamps(['bad_name.sql']);
    expect(violations.some((violation) => violation.ruleId === 'migration_filename_format')).toBe(
      true,
    );
  });

  it('warns when consecutive prefix dates jump more than 90 days', () => {
    const violations = lintMigrationTimestamps([
      '20250201000001_first.sql',
      '20260501000001_second.sql',
    ]);
    expect(violations.some((violation) => violation.ruleId === 'migration_timestamp_gap')).toBe(
      true,
    );
  });

  it('repo migrations pass monotonic timestamp lint', async () => {
    const { readdir } = await import('node:fs/promises');
    const migrationsFolder = resolve(process.cwd(), 'migrations');
    const filenames = (await readdir(migrationsFolder)).filter(
      (file) => file.endsWith('.sql') && !file.endsWith('.down.sql'),
    );
    const violations = lintMigrationTimestamps(filenames);
    const errors = violations.filter((violation) => violation.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('migration prefix helpers', () => {
  it('getMaxMigrationPrefix returns the greatest valid prefix', () => {
    expect(
      getMaxMigrationPrefix([
        '20260530000001_alpha.sql',
        'bad.sql',
        '20260530000002_beta.sql',
        '20260529000001_gamma.sql',
      ]),
    ).toBe('20260530000002');
  });

  it('incrementMigrationPrefix adds one to the numeric prefix', () => {
    expect(incrementMigrationPrefix('20260530000002')).toBe('20260530000003');
  });

  it('suggestNextMigrationPrefix increments after current max', () => {
    expect(suggestNextMigrationPrefix(['20260530000001_a.sql', '20260530000002_b.sql'])).toEqual({
      currentMax: '20260530000002',
      nextPrefix: '20260530000003',
    });
  });
});
