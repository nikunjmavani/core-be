import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { lintMigrationsDirectory } from '@/scripts/validators/migration/lint-migrations.js';

const brokenFixtureFolder = resolve(
  process.cwd(),
  'src/tests/fixtures/migration-rollback-lint/broken-missing-down',
);
const productionMigrationsFolder = resolve(process.cwd(), 'migrations');

/**
 * Forward-only deploys use compensating migrations in production; optional `.down.sql`
 * companions are allowed only when the up file declares `migration-rollback: requires down`.
 * `pnpm db:migrate:lint` (CI quality job) enforces pairing before merge.
 */
describe('Integration: migration rollback lint (CI gate)', () => {
  it('should pass rollback pairing lint for production migrations/', async () => {
    const result = await lintMigrationsDirectory(productionMigrationsFolder);
    expect(result.rollbackViolations).toEqual([]);
  });

  it('should fail db:migrate:lint for broken rollback fixture (missing .down.sql)', () => {
    expect(() => {
      execSync(`pnpm db:migrate:lint ${brokenFixtureFolder}`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    }).toThrow();
  });
});
