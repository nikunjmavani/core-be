/**
 * Prints the next suggested migration filename prefix (strictly after current max).
 * Usage: pnpm db:migrate:next-prefix [description_snippet]
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { suggestNextMigrationPrefix } from '@/scripts/validators/migration/lint-migrations.js';

async function main(): Promise<void> {
  const migrationsFolder = resolve(process.cwd(), 'migrations');
  const entries = await readdir(migrationsFolder);
  const upFilenames = entries.filter(
    (filename) => filename.endsWith('.sql') && !filename.endsWith('.down.sql'),
  );

  const { currentMax, nextPrefix } = suggestNextMigrationPrefix(upFilenames);
  const descriptionSnippet = process.argv[2]?.trim();
  const suffix =
    descriptionSnippet && descriptionSnippet.length > 0 ? descriptionSnippet : 'your_description';
  const snakeSuffix = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (currentMax === null) {
    console.log('Current max: (no valid up migrations found)');
  } else {
    console.log(`Current max: ${currentMax}`);
  }
  console.log(`Suggested next prefix: ${nextPrefix}`);
  console.log(`Filename: ${nextPrefix}_${snakeSuffix}.sql`);
  console.log('');
  console.log('Do not use date -u +%Y%m%d unless the value sorts after the suggested prefix.');
  console.log('Run pnpm db:migrate:lint after creating the migration file.');
}

void main();
