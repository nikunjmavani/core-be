/**
 * Sync `.env.example` and `.env.local.example` with env schema: report added/removed vars,
 * optionally patch both files (--fix), and print a PR description snippet for env changes.
 *
 * Usage:
 *   pnpm tool:sync-env-example           # Report only, print PR snippet
 *   pnpm tool:sync-env-example --fix     # Append missing vars to both example files, print PR snippet
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchemaKeys } from '@/shared/config/env-schema.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const envExamplePath = resolve(projectRoot, '.env.example');
const envLocalExamplePath = resolve(projectRoot, '.env.local.example');

const envLocalExampleHeader = `# =============================================================================
# Local overrides template — copy to \`.env.local\` (gitignored)
# =============================================================================
# Loaded after \`.env\` — values here overwrite \`.env\`. Use for machine-specific or secret overrides.
# Copy: cp .env.local.example .env.local
# Full reference and defaults: see \`.env.example\`
# =============================================================================

`;

function parseEnvExampleKeys(content: string): {
  uncommentedKeys: string[];
  documentedKeys: string[];
} {
  const uncommentedKeys: string[] = [];
  const documentedKeys: string[] = [];
  const uncommentedKeyRegex = /^([A-Z][A-Z0-9_]*)\s*=/;
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded env key names; optional leading #
  const documentedKeyRegex = /^(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=/;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const documentedMatch = trimmed.match(documentedKeyRegex);
    if (documentedMatch) documentedKeys.push(documentedMatch[1]!);
    if (trimmed.startsWith('#')) continue;
    const uncommentedMatch = trimmed.match(uncommentedKeyRegex);
    if (uncommentedMatch) uncommentedKeys.push(uncommentedMatch[1]!);
  }
  return { uncommentedKeys, documentedKeys };
}

function syncOneFile(parameters: {
  filePath: string;
  label: string;
  fix: boolean;
  schemaKeys: Set<string>;
  envSchemaKeysList: readonly string[];
}): { added: string[]; removed: string[]; fixed: boolean; label: string } {
  if (!existsSync(parameters.filePath)) {
    if (parameters.filePath === envLocalExamplePath) {
      writeFileSync(parameters.filePath, envLocalExampleHeader, 'utf-8');
      console.log('Created', parameters.label, 'with header.');
    } else {
      throw new Error(`Missing ${parameters.label}: ${parameters.filePath}`);
    }
  }

  const content = readFileSync(parameters.filePath, 'utf-8');
  const { uncommentedKeys, documentedKeys } = parseEnvExampleKeys(content);
  const documentedSet = new Set(documentedKeys);

  const added = parameters.envSchemaKeysList.filter((key) => !documentedSet.has(key));
  const removed = uncommentedKeys.filter((key) => !parameters.schemaKeys.has(key));

  let fixed = false;
  if (added.length > 0 && parameters.fix) {
    const appendix = [
      '',
      '# Synced from env schema (add description/placeholder as needed)',
      ...added.map((key) => `# ${key}=`),
    ].join('\n');
    writeFileSync(parameters.filePath, content.trimEnd() + appendix + '\n', 'utf-8');
    console.log('Updated', parameters.label, ': appended', added.length, 'missing var(s).');
    fixed = true;
  }

  return { added, removed, fixed, label: parameters.label };
}

function main(): void {
  const fix = process.argv.includes('--fix');
  const schemaKeys = new Set<string>(envSchemaKeys);

  const results = [
    syncOneFile({
      filePath: envExamplePath,
      label: '.env.example',
      fix,
      schemaKeys,
      envSchemaKeysList: envSchemaKeys,
    }),
    syncOneFile({
      filePath: envLocalExamplePath,
      label: '.env.local.example',
      fix,
      schemaKeys,
      envSchemaKeysList: envSchemaKeys,
    }),
  ];

  const allAdded = [...new Set(results.flatMap((result) => result.added))];
  const allRemoved = [...new Set(results.flatMap((result) => result.removed))];
  const anyFixed = results.some((result) => result.fixed);

  if (allAdded.length > 0 || allRemoved.length > 0) {
    console.error('');
    console.error(
      'One or more env example files are OUT OF SYNC with env schema (src/shared/config/env-schema.ts).',
    );
    for (const result of results) {
      if (result.added.length > 0) {
        console.error(`[${result.label}] Missing keys (in schema):`, result.added.join(', '));
      }
      if (result.removed.length > 0) {
        console.error(
          `[${result.label}] Extra uncommented keys (not in schema):`,
          result.removed.join(', '),
        );
      }
    }
    if (!fix && allAdded.length > 0) {
      console.error(
        'Fix: run pnpm tool:sync-env-example --fix then add descriptions to .env.example / .env.local.example as needed.',
      );
    }
    if (allRemoved.length > 0) {
      console.error(
        'Fix: remove these uncommented lines from the example file(s) or add them to the env schema.',
      );
    }
    console.log('\n--- Copy below into PR description ---\n');
    console.log('## Environment variable changes');
    if (allAdded.length > 0) console.log('- **Added:**', allAdded.join(', '));
    if (allRemoved.length > 0) console.log('- **Removed:**', allRemoved.join(', '));
    console.log('\n--- End PR description snippet ---\n');

    if (allRemoved.length > 0) {
      process.exit(1);
    }
    if (allAdded.length > 0 && !fix) {
      process.exit(1);
    }
    process.exit(anyFixed ? 0 : 1);
  }

  console.log(
    '.env.example and .env.local.example are in sync with env schema. No PR snippet needed.',
  );
}

main();
