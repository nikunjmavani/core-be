/** Domain policy: legacy public.organizations must not be referenced in application code. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = join(PROJECT_ROOT, 'src');
/**
 * Init migration consolidates all earlier migrations. We confirm via the init that there is no
 * legacy `public.organizations` table being created (a stray reference would mean the legacy
 * artifact crept back in).
 */
const INIT_MIGRATION = join(PROJECT_ROOT, 'migrations/00000000000000_init.sql');

const SOURCE_EXTENSIONS = new Set(['.ts', '.js']);

function collectSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === '__tests__') {
        continue;
      }
      collectSourceFiles(fullPath, collected);
      continue;
    }
    const extension = entry.slice(entry.lastIndexOf('.'));
    if (SOURCE_EXTENSIONS.has(extension)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

describe('legacy public.organizations policy', () => {
  it('must not reference public.organizations in src/', () => {
    const violations: string[] = [];

    for (const filePath of collectSourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      if (source.includes('public.organizations')) {
        violations.push(filePath.replace(`${PROJECT_ROOT}/`, ''));
      }
    }

    expect(violations).toEqual([]);
  });

  it('init migration does not create public.organizations (legacy schema dropped)', () => {
    const migrationSql = readFileSync(INIT_MIGRATION, 'utf8');
    expect(migrationSql).not.toContain('CREATE TABLE "public"."organizations"');
    expect(migrationSql).toContain('CREATE TABLE "tenancy"."organizations"');
  });
});
