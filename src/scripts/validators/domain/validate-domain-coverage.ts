/**
 * Ensures each domain with HTTP routes has at least one integration test file.
 * Usage: pnpm validate:domain:coverage
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOMAINS_DIRECTORY = resolve(process.cwd(), 'src/domains');

const MINIMUM_INTEGRATION_TEST_FILES = 1;

function listIntegrationTestFiles(domainPath: string): string[] {
  const testsDirectory = join(domainPath, '__tests__');
  if (!existsSync(testsDirectory)) return [];

  const files: string[] = [];
  const walk = (directory: string, relativePrefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (relativePath === 'unit' || relativePath.startsWith('unit/')) continue;
        walk(fullPath, relativePath);
      } else if (entry.name.endsWith('.test.ts')) {
        files.push(relativePath);
      }
    }
  };

  walk(testsDirectory, '');
  return files;
}

function main(): void {
  const strictMode = process.argv.includes('--strict');
  let hasFailures = false;

  const domains = readdirSync(DOMAINS_DIRECTORY).filter((name) => {
    const domainPath = join(DOMAINS_DIRECTORY, name);
    try {
      return (
        readdirSync(domainPath, { withFileTypes: true }).some(
          (entry) => entry.isFile() && entry.name.endsWith('.routes.ts'),
        ) || existsSync(join(domainPath, `${name}.container.ts`))
      );
    } catch {
      return false;
    }
  });

  for (const domain of domains) {
    const domainPath = join(DOMAINS_DIRECTORY, domain);
    const hasRoutes =
      existsSync(join(domainPath, `${domain}.routes.ts`)) ||
      readdirSync(domainPath, { recursive: true }).some((entry) =>
        String(entry).endsWith('.routes.ts'),
      );

    if (!hasRoutes) continue;

    const integrationTests = listIntegrationTestFiles(domainPath);
    if (integrationTests.length < MINIMUM_INTEGRATION_TEST_FILES) {
      hasFailures = true;
      console.error(
        `❌ ${domain}: expected at least ${MINIMUM_INTEGRATION_TEST_FILES} integration test file(s) under __tests__/ (excluding unit/)`,
      );
    } else {
      console.log(`✅ ${domain} (${integrationTests.length} integration test file(s))`);
    }
  }

  if (hasFailures && strictMode) {
    process.exit(1);
  }

  if (hasFailures) {
    console.warn('\nRe-run with --strict to fail CI, or add domain e2e tests under __tests__/.');
    process.exit(0);
  }

  process.exit(0);
}

main();
