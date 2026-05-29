#!/usr/bin/env tsx
/**
 * `pnpm db:migrate:new <slug>` — create a new empty migration file with a
 * timestamp-based ordering prefix.
 *
 * The 14-digit prefix is real UTC `YYYYMMDDHHMMSS` (not a `_000001` counter)
 * so concurrent developers on different branches generate distinct prefixes
 * by default and avoid the trivial merge conflict that comes from two PRs
 * each claiming `_000NNN` on the same day. Falls back to incrementing the
 * current max when "now" is not strictly greater (clock skew or two
 * migrations created in the same second).
 *
 * Usage:
 *   pnpm db:migrate:new add_user_avatar_url
 *   pnpm db:migrate:new system_tables_rls_deny_all
 *
 * Output:
 *   migrations/20260528054321_add_user_avatar_url.sql
 */
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { suggestNextMigrationPrefix } from '@/scripts/validators/migration/lint-migrations.js';

const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/u;
const MAXIMUM_SLUG_LENGTH = 60;

function migrationFileHeader({
  slug,
  createdAtIso,
}: {
  slug: string;
  createdAtIso: string;
}): string {
  return `-- Migration: ${slug}
-- Created: ${createdAtIso}
-- Reference: docs/reference/data/migrations.md
--
-- Statements run inside a single transaction. Use \`--> statement-breakpoint\`
-- between statements only when the postgres simple-query protocol needs each
-- statement sent independently (DO blocks, dollar quoting, dependent DDL).
--
-- Non-transactional lane (CREATE INDEX CONCURRENTLY): add
-- \`-- migration-transaction: none reason="..."\` in the first 20 lines to run
-- statements outside a transaction. Keep every statement idempotent
-- (IF NOT EXISTS) — there is no rollback if one fails mid-file.
--
-- Migration-safety lints (\`pnpm db:migrate:lint\`):
--   - CREATE TABLE / INDEX / SCHEMA must use IF NOT EXISTS.
--   - Use \`ADD COLUMN ... NULL\` + backfill + \`SET NOT NULL\` (never NOT NULL inline).
--   - Use \`ADD CONSTRAINT ... NOT VALID\` for FK / CHECK, then \`VALIDATE\` later.
--   - Use \`CREATE INDEX CONCURRENTLY\` in a \`migration-transaction: none\` migration.
--
-- Override a rule with: \`-- migration-safety: allow <rule_id> reason="..."\` in
-- the first 20 lines.

`;
}

async function main(): Promise<void> {
  const slug = process.argv[2];

  if (!slug || slug === '--help' || slug === '-h') {
    process.stdout.write(
      'Usage: pnpm db:migrate:new <snake_case_slug>\n' +
        'Example: pnpm db:migrate:new add_user_avatar_url\n',
    );
    process.exit(slug ? 0 : 2);
  }

  if (!SLUG_PATTERN.test(slug)) {
    process.stderr.write(
      `Invalid slug "${slug}". Use lowercase snake_case (start with letter; letters, digits, underscores only).\n`,
    );
    process.exit(2);
  }

  if (slug.length > MAXIMUM_SLUG_LENGTH) {
    process.stderr.write(`Slug exceeds ${MAXIMUM_SLUG_LENGTH} characters: ${slug.length}\n`);
    process.exit(2);
  }

  const migrationsFolder = resolve(process.cwd(), 'migrations');
  const directoryEntries = await readdir(migrationsFolder);
  const upMigrationFilenames = directoryEntries.filter(
    (filename) => filename.endsWith('.sql') && !filename.endsWith('.down.sql'),
  );

  const now = new Date();
  const { currentMax, nextPrefix } = suggestNextMigrationPrefix(upMigrationFilenames, now);
  const filename = `${nextPrefix}_${slug}.sql`;
  const fullPath = resolve(migrationsFolder, filename);

  if (existsSync(fullPath)) {
    process.stderr.write(`Refusing to overwrite existing migration: ${filename}\n`);
    process.exit(1);
  }

  await writeFile(fullPath, migrationFileHeader({ slug, createdAtIso: now.toISOString() }));

  process.stdout.write(`Created migration: migrations/${filename}\n`);
  if (currentMax !== null) {
    process.stdout.write(`  previous max:    ${currentMax}\n`);
  }
  process.stdout.write(`  next prefix:     ${nextPrefix}\n`);
  process.stdout.write(`\nNext steps:\n`);
  process.stdout.write(`  1. Edit migrations/${filename}\n`);
  process.stdout.write(`  2. pnpm db:migrate:lint\n`);
  process.stdout.write(`  3. pnpm db:migrate\n`);
}

main().catch((error) => {
  process.stderr.write(
    `db:migrate:new failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
