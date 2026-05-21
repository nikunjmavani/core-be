/**
 * Ensures every *.test.ts uses a recognized tier suffix and lives in the matching folder.
 * Usage: pnpm validate:test-naming
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

const TIER_SUFFIXES = [
  'unit',
  'integration',
  'e2e',
  'smoke',
  'chaos',
  'contract',
  'security',
  'performance',
  'global',
] as const;

type TierSuffix = (typeof TIER_SUFFIXES)[number];

function detectTier(fileName: string): TierSuffix | undefined {
  for (const tier of TIER_SUFFIXES) {
    if (fileName.endsWith(`.${tier}.test.ts`)) return tier;
  }
  return undefined;
}

function isPathAllowedForTier(relativePath: string, tier: TierSuffix): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  switch (tier) {
    case 'unit':
      return (
        normalized.includes('/__tests__/unit/') ||
        normalized.startsWith('tests/unit/') ||
        normalized.startsWith('tests/helpers/') ||
        normalized.includes('/unit/events/')
      );
    case 'integration':
      return (
        normalized.includes('/__tests__/integration/') ||
        normalized.startsWith('tests/integration/')
      );
    case 'e2e':
      return normalized.includes('/__tests__/e2e/') || normalized.startsWith('tests/e2e/');
    case 'smoke':
      return normalized.startsWith('tests/smoke/');
    case 'security':
      return normalized.startsWith('tests/security/');
    case 'performance':
      return normalized.startsWith('tests/performance/');
    case 'contract':
      return normalized.startsWith('tests/contract/');
    case 'chaos':
      return normalized.startsWith('tests/chaos/');
    case 'global':
      return normalized.startsWith('tests/global/');
    default:
      return false;
  }
}

function walk(directory: string, collector: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(fullPath, collector);
      continue;
    }
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      collector.push(fullPath);
    }
  }
}

function main(): void {
  const errors: string[] = [];
  const testFiles: string[] = [];
  walk(ROOT, testFiles);

  for (const filePath of testFiles) {
    const fileName = filePath.split('/').pop() ?? filePath;
    const tier = detectTier(fileName);
    const relativePath = relative(ROOT, filePath);

    if (!tier) {
      errors.push(`Missing tier suffix in filename: ${relativePath}`);
      continue;
    }

    if (!isPathAllowedForTier(relativePath, tier)) {
      errors.push(`*.${tier}.test.ts in wrong folder: ${relativePath}`);
    }
  }

  const domainsDir = join(ROOT, 'domains');
  const findForbiddenEventsTests = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'events' && existsSync(join(fullPath, '__tests__'))) {
          errors.push(
            `Forbidden events/__tests__/ — use __tests__/unit/events/: ${relative(ROOT, join(fullPath, '__tests__'))}`,
          );
        }
        findForbiddenEventsTests(fullPath);
      }
    }
  };
  if (existsSync(domainsDir)) findForbiddenEventsTests(domainsDir);

  if (errors.length > 0) {
    console.error('validate-test-naming failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(`✅ validate-test-naming passed (${testFiles.length} test files)`);
}

main();
