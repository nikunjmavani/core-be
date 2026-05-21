/**
 * Sync the canonical `.env.example` template with the env schema
 * (`src/shared/config/env-schema.ts`).
 *
 * `.env.example` is the single committed env template — every schema key must appear
 * (commented or uncommented). Per-environment `.env.<name>` files are gitignored copies
 * created by `pnpm env:init` and are NOT validated here.
 *
 * Usage:
 *   pnpm tool:sync-env-example           # Report only, print PR snippet
 *   pnpm tool:sync-env-example --fix     # Append missing keys to .env.example
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchemaKeys } from '@/shared/config/env-schema.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
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

/**
 * Verify `.env.example` declares both required top-level halves. The two-half
 * structure ("GitHub Secrets" + "GitHub Variables") is the only classification
 * source — `pnpm env:sync` reads it directly when pushing to GitHub. If a half
 * is missing, every key under it would silently fall into the other half.
 */
function checkTopLevelHalves(content: string): string[] {
  const lines = content.split('\n');
  const halfSeparator = /^#\s#{3,}\s*$/;
  const titleLine = /^#\s+(.+?)\s*$/;
  const titles: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!halfSeparator.test(lines[index] ?? '')) continue;
    const next = lines[index + 1] ?? '';
    const after = lines[index + 2] ?? '';
    const match = next.match(titleLine);
    if (match && halfSeparator.test(after)) {
      titles.push(match[1]!.trim());
      index += 2;
    }
  }

  const issues: string[] = [];
  const hasSecrets = titles.some((title) => /github secrets/i.test(title));
  const hasVariables = titles.some((title) => /github variables/i.test(title));
  if (!hasSecrets) {
    issues.push(
      '.env.example is missing the "# GitHub Secrets" top-level half (`# ###` banner). Without it, every key would be pushed as a variable.',
    );
  }
  if (!hasVariables) {
    issues.push(
      '.env.example is missing the "# GitHub Variables" top-level half (`# ###` banner). Without it, every key would be pushed as a secret.',
    );
  }
  return issues;
}

function main(): void {
  const fix = process.argv.includes('--fix');
  const schemaKeys = new Set<string>(envSchemaKeys);

  if (!existsSync(envExamplePath)) {
    console.error('Missing .env.example at the repo root.');
    process.exit(1);
  }

  const content = readFileSync(envExamplePath, 'utf-8');
  const { uncommentedKeys, documentedKeys } = parseEnvExampleKeys(content);
  const documentedSet = new Set(documentedKeys);

  const added = envSchemaKeys.filter((key) => !documentedSet.has(key));
  const removed = uncommentedKeys.filter((key) => !schemaKeys.has(key));
  const structuralIssues = checkTopLevelHalves(content);

  if (added.length === 0 && removed.length === 0 && structuralIssues.length === 0) {
    console.log('.env.example is in sync with the env schema.');
    process.exit(0);
  }

  for (const issue of structuralIssues) {
    console.error(issue);
  }

  console.error('');
  console.error('.env.example is OUT OF SYNC with env schema (src/shared/config/env-schema.ts).');
  if (added.length > 0) {
    console.error('  Missing keys (in schema):', added.join(', '));
  }
  if (removed.length > 0) {
    console.error('  Extra uncommented keys (not in schema):', removed.join(', '));
  }

  let fixed = false;
  if (added.length > 0 && fix) {
    const appendix = [
      '',
      '# Synced from env schema (add description/placeholder as needed)',
      ...added.map((key) => `# ${key}=`),
    ].join('\n');
    writeFileSync(envExamplePath, content.trimEnd() + appendix + '\n', 'utf-8');
    console.log(`Appended ${added.length} missing key(s) to .env.example.`);
    fixed = true;
  }

  if (!fix && added.length > 0) {
    console.error(
      'Fix: run `pnpm tool:sync-env-example --fix` then add descriptions to .env.example as needed.',
    );
  }
  if (removed.length > 0) {
    console.error('Fix: remove these uncommented lines or add them to the env schema.');
  }

  console.log('\n--- Copy below into PR description ---\n');
  console.log('## Environment variable changes');
  if (added.length > 0) console.log('- **Added:**', added.join(', '));
  if (removed.length > 0) console.log('- **Removed:**', removed.join(', '));
  console.log('\n--- End PR description snippet ---\n');

  const hasUnfixableDrift =
    removed.length > 0 || (added.length > 0 && !fixed) || structuralIssues.length > 0;
  process.exit(hasUnfixableDrift ? 1 : 0);
}

main();
