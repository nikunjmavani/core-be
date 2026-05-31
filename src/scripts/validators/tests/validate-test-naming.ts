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

/** Returns whether a test file is exempt from the `*.tier.test.ts` filename convention. */
export function isExemptFromTierSuffix(relativePath: string, fileName: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');

  // Bundled domain e2e: domains/<d>/__tests__/<d>.test.ts
  const bundledDomainMatch = normalized.match(/^domains\/([^/]+)\/__tests__\/\1\.test\.ts$/);
  if (bundledDomainMatch) return true;

  // Sub-domain __tests__/*.test.ts route suites (excluding forbidden events/__tests__)
  if (
    normalized.match(/^domains\/.*\/__tests__\/[^/]+\.test\.ts$/) &&
    !normalized.includes('/events/__tests__/')
  ) {
    return true;
  }

  // Worker suite naming at sub-domain root __tests__
  if (normalized.includes('/__tests__/') && fileName.endsWith('.worker.test.ts')) {
    return true;
  }

  // Legacy validator tests co-located under __tests__/unit/
  if (normalized.includes('/__tests__/unit/') && fileName.endsWith('.validator.test.ts')) {
    return true;
  }

  // Policy scan tests under tests/unit/
  if (normalized.startsWith('tests/unit/') && fileName.endsWith('.policy.test.ts')) {
    return true;
  }

  // Legacy infra/context tests without tier in filename
  if (
    normalized.startsWith('infrastructure/') &&
    normalized.includes('/__tests__/') &&
    fileName.endsWith('.test.ts')
  ) {
    return true;
  }

  return false;
}

/** Parses the Vitest tier suffix from a test filename, if present. */
export function detectTier(fileName: string): TierSuffix | undefined {
  if (fileName.endsWith('.db.unit.test.ts')) return 'unit';
  for (const tier of TIER_SUFFIXES) {
    if (fileName.endsWith(`.${tier}.test.ts`)) return tier;
  }
  return undefined;
}

/** Returns whether a test file path is allowed for the given Vitest tier suffix. */
export function isPathAllowedForTier(relativePath: string, tier: TierSuffix): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  switch (tier) {
    case 'unit':
      return (
        normalized.includes('/__tests__/unit/') ||
        normalized.startsWith('tests/unit/') ||
        normalized.startsWith('tests/helpers/') ||
        normalized.includes('/unit/events/') ||
        normalized.startsWith('infrastructure/') ||
        normalized.startsWith('scripts/')
      );
    case 'integration':
      return (
        normalized.includes('/__tests__/integration/') ||
        normalized.startsWith('tests/integration/') ||
        normalized.startsWith('scripts/')
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
      if (isExemptFromTierSuffix(relativePath, fileName)) continue;
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
