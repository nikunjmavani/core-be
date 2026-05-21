/**
 * Sync .env.example with env schema: report added/removed vars, optionally patch .env.example (--fix),
 * and print a PR description snippet for env changes.
 *
 * Usage:
 *   pnpm scripts:sync-env-example           # Report only, print PR snippet
 *   pnpm scripts:sync-env-example --fix     # Append missing vars to .env.example, print PR snippet
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchemaKeys } from '@/shared/config/env-schema.js';

const projectRoot = resolve(import.meta.dirname, '../..');
const envExamplePath = resolve(projectRoot, '.env.example');

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

function main(): void {
  const fix = process.argv.includes('--fix');
  const schemaKeys = new Set<string>(envSchemaKeys);
  const content = readFileSync(envExamplePath, 'utf-8');
  const { uncommentedKeys, documentedKeys } = parseEnvExampleKeys(content);
  const documentedSet = new Set(documentedKeys);

  const added = envSchemaKeys.filter((key: string) => !documentedSet.has(key));
  const removed = uncommentedKeys.filter((key: string) => !schemaKeys.has(key));

  if (added.length > 0 && fix) {
    const appendix = [
      '',
      '# Synced from env schema (add description/placeholder as needed)',
      ...added.map((key) => `# ${key}=`),
    ].join('\n');
    writeFileSync(envExamplePath, content.trimEnd() + appendix + '\n', 'utf-8');
    console.log('Updated .env.example: appended', added.length, 'missing var(s).');
  }

  if (added.length > 0 || removed.length > 0) {
    console.error('');
    console.error('.env.example is OUT OF SYNC with env schema (src/shared/config/env-schema.ts).');
    if (added.length > 0) {
      console.error('Missing in .env.example (in schema):', added.join(', '));
      if (!fix)
        console.error(
          'Fix: run pnpm scripts:sync-env-example --fix then add descriptions, or add these keys to .env.example.',
        );
    }
    if (removed.length > 0) {
      console.error('Extra in .env.example (not in schema):', removed.join(', '));
      console.error('Fix: remove these lines from .env.example or add them to the env schema.');
    }
    console.log('\n--- Copy below into PR description ---\n');
    console.log('## Environment variable changes');
    if (added.length > 0) console.log('- **Added:**', added.join(', '));
    if (removed.length > 0) console.log('- **Removed:**', removed.join(', '));
    console.log('\n--- End PR description snippet ---\n');
  } else {
    console.log('.env.example is in sync with env schema. No PR snippet needed.');
  }

  if (added.length > 0 || removed.length > 0) {
    process.exit(fix && added.length > 0 ? 0 : 1);
  }
}

main();
