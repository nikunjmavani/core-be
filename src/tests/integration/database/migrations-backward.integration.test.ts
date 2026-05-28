import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  lintMigrationRollbackPairing,
  parseMigrationRollbackHeader,
} from '@/scripts/validators/migration/lint-migrations.js';

function isDownMigrationFilename(filename: string): boolean {
  return filename.endsWith('.down.sql');
}

/**
 * core-be uses forward-only SQL migrations in production; optional `.down.sql` files are
 * allowed only when the up migration declares `migration-rollback: requires down`.
 */
describe('Integration: migrations backward (forward-only + optional down companions)', () => {
  it('should not ship orphan .down.sql or up files that require down without a companion', async () => {
    const migrationsFolder = resolve(process.cwd(), 'migrations');
    const allFiles = (await readdir(migrationsFolder))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const upMigrationFilenames = allFiles.filter((filename) => !isDownMigrationFilename(filename));

    const fileContentsByFilename = new Map<string, string>();
    for (const filename of allFiles) {
      fileContentsByFilename.set(
        filename,
        await readFile(resolve(migrationsFolder, filename), 'utf8'),
      );
    }

    const rollbackViolations = lintMigrationRollbackPairing(
      migrationsFolder,
      upMigrationFilenames,
      fileContentsByFilename,
    );

    expect(rollbackViolations).toEqual([]);

    for (const filename of upMigrationFilenames) {
      const fileContent = fileContentsByFilename.get(filename);
      expect(fileContent).toBeDefined();
      const { requiresDown, headerErrors } = parseMigrationRollbackHeader(fileContent!);
      expect(headerErrors).toEqual([]);
      if (requiresDown) {
        expect(allFiles).toContain(filename.replace(/\.sql$/i, '.down.sql'));
      }
    }
  });
});
