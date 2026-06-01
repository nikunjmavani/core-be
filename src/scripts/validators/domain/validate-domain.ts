/**
 * CI gate for new domains — validates that a domain has all required files.
 * Usage: pnpm validate:domain [domain-name]
 *
 * Checks:
 * - Routes file or container file exists
 * - __tests__ directory exists; routed domains have __tests__/integration/*.test.ts
 * - Vitest specs only under __tests__/unit/, __tests__/integration/, or events/__tests__/
 * - Multi-sub-domain domains: sub-domains/ + at least one *.service.ts in tree
 * - Domain root dirs limited to reserved names (multi-resource domains)
 * - Optional warnings: schema, depth, empty factories, routes without controllers
 *
 * Exit code 0 = all checks pass; 1 = failures found.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';

const DOMAINS_DIR = resolve(process.cwd(), 'src/domains');

/** Domains without sub-domains/ (layers at domain root). */
const FLAT_DOMAINS = new Set(['audit', 'upload']);

/** Allowed top-level directories under multi-resource domains. */
const RESERVED_DOMAIN_ROOT_DIRS = new Set([
  'sub-domains',
  'events',
  '__tests__',
  'workers',
  'handlers', // auth-only: route handler factories
  'shared', // auth-only: cross-handler helpers
  'seed', // per-domain seed/ dir (DomainSeedModule: reference + bulk seeders)
]);

/** Allowed subdirectories directly under `__tests__/`. */
const ALLOWED_TESTS_SUBDIRS = new Set(['unit', 'integration', 'e2e', 'factories']);

interface ValidationResult {
  domain: string;
  errors: string[];
  warnings: string[];
}

function listDomainEntries(domainPath: string): string[] {
  return readdirSync(domainPath, { recursive: true }) as string[];
}

function walkEmptyTestDirectories(directoryPath: string, result: ValidationResult): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        if (basename(join(entryPath, '..')) === 'events') {
          continue;
        }
        const testFiles = readdirSync(entryPath).filter(
          (fileName) => fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx'),
        );
        const nonTestEntries = readdirSync(entryPath).filter(
          (fileName) => !(fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx')),
        );
        if (testFiles.length > 0) {
          result.errors.push(
            `Vitest specs must live under unit/ or integration/ — move: ${entryPath.replace(`${DOMAINS_DIR}/`, '')}/${testFiles.join(', ')}`,
          );
        }

        const hasOnlyPlaceholders =
          testFiles.length === 0 &&
          nonTestEntries.every(
            (fileName) => fileName === '.gitkeep' || ALLOWED_TESTS_SUBDIRS.has(fileName),
          );
        const unitPath = join(entryPath, 'unit');
        const factoriesPath = join(entryPath, 'factories');
        const integrationPath = join(entryPath, 'integration');
        const unitHasTests =
          existsSync(unitPath) &&
          readdirSync(unitPath).some((fileName) => fileName.endsWith('.test.ts'));
        const factoriesHasHelpers =
          existsSync(factoriesPath) &&
          readdirSync(factoriesPath).some((fileName) => fileName.endsWith('.ts'));
        const integrationHasTests =
          existsSync(integrationPath) &&
          readdirSync(integrationPath).some((fileName) => fileName.endsWith('.test.ts'));
        if (hasOnlyPlaceholders && !unitHasTests && !factoriesHasHelpers && !integrationHasTests) {
          result.warnings.push(
            `Empty __tests__ at ${entryPath.replace(`${DOMAINS_DIR}/`, '')} — remove placeholder or add tests`,
          );
        }
      }
      walkEmptyTestDirectories(entryPath, result);
    }
  }
}

function isMultiResourceDomain(domainName: string): boolean {
  return !FLAT_DOMAINS.has(domainName);
}

function validateDomain(domainName: string): ValidationResult {
  const domainPath = join(DOMAINS_DIR, domainName);
  const result: ValidationResult = { domain: domainName, errors: [], warnings: [] };

  if (!existsSync(domainPath)) {
    result.errors.push(`Domain directory does not exist: ${domainPath}`);
    return result;
  }

  const hasRoutes = existsSync(join(domainPath, `${domainName}.routes.ts`));
  const hasContainer = existsSync(join(domainPath, `${domainName}.container.ts`));
  if (!(hasRoutes || hasContainer)) {
    result.errors.push('Missing .routes.ts or .container.ts');
  }

  if (!existsSync(join(domainPath, '__tests__'))) {
    result.errors.push('Missing __tests__/ directory');
  }

  const rootEntries = readdirSync(domainPath, { withFileTypes: true });
  const rootDirectories = rootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (isMultiResourceDomain(domainName)) {
    if (!rootDirectories.includes('sub-domains')) {
      result.errors.push('Multi-resource domain must have sub-domains/ directory');
    }

    for (const directoryName of rootDirectories) {
      if (RESERVED_DOMAIN_ROOT_DIRS.has(directoryName)) continue;
      result.errors.push(
        `Unexpected directory at domain root: ${directoryName}/ (move resources under sub-domains/)`,
      );
    }

    if (domainName !== 'user' && rootDirectories.includes('workers')) {
      result.warnings.push(
        'workers/ at domain root — prefer sub-domains/<resource>/workers/ unless domain-wide retention',
      );
    }
  } else {
    for (const directoryName of rootDirectories) {
      if (directoryName === '__tests__' || directoryName === 'workers') continue;
      if (directoryName === 'sub-domains') {
        result.warnings.push('Flat domain has sub-domains/ — omit unless splitting resources');
      }
    }
  }

  const allEntries = listDomainEntries(domainPath);
  const hasRootService = existsSync(join(domainPath, `${domainName}.service.ts`));
  const hasServiceInTree = allEntries.some((entry) => String(entry).endsWith('.service.ts'));

  if (hasContainer && !hasRootService && !hasServiceInTree) {
    result.errors.push('Multi-sub-domain domain must have at least one .service.ts in the tree');
  } else if (!(hasContainer || hasRootService || hasServiceInTree)) {
    result.warnings.push('No .service.ts at domain root or in sub-domains');
  }

  const hasSchema = allEntries.some((entry) => String(entry).endsWith('.schema.ts'));
  if (!hasSchema) {
    result.warnings.push('No .schema.ts file found (may use schemas from other domains)');
  }

  const maxDepth = allEntries.reduce((deepest, entry) => {
    const depth = String(entry).split('/').length;
    return Math.max(deepest, depth);
  }, 0);
  if (maxDepth > 6) {
    result.warnings.push(
      `Folder depth under domain exceeds 6 (${maxDepth}); prefer depth ≤ 5 under sub-domains/ for new work`,
    );
  }

  walkEmptyTestDirectories(domainPath, result);

  const factoriesPath = join(domainPath, '__tests__', 'factories');
  if (existsSync(factoriesPath) && readdirSync(factoriesPath).length === 0) {
    result.warnings.push('Empty __tests__/factories/ directory — remove or add factory helpers');
  }

  const domainUnitPath = join(domainPath, '__tests__', 'unit');
  if (existsSync(domainUnitPath) && readdirSync(domainUnitPath).length === 0) {
    result.warnings.push('Empty __tests__/unit/ directory — remove or add unit tests');
  }

  const domainIntegrationPath = join(domainPath, '__tests__', 'integration');
  if (hasRoutes && existsSync(join(domainPath, '__tests__'))) {
    const integrationTestsInTree = listDomainEntries(domainPath).filter((entry) =>
      String(entry).includes('__tests__/integration/'),
    );
    const hasIntegrationTestFile = integrationTestsInTree.some((entry) =>
      String(entry).endsWith('.test.ts'),
    );
    if (!hasIntegrationTestFile) {
      result.errors.push(
        'Routed domain must have at least one *.test.ts under __tests__/integration/ (domain or sub-domain)',
      );
    }
    if (existsSync(domainIntegrationPath) && readdirSync(domainIntegrationPath).length === 0) {
      result.warnings.push(
        'Empty __tests__/integration/ at domain root — remove or add bundled route integration tests',
      );
    }
  }

  for (const entry of allEntries) {
    const entryString = String(entry);
    if (entryString.includes('events/__tests__/')) {
      result.errors.push(
        `Forbidden events/__tests__/ — move to __tests__/unit/events/ (see docs/getting-started/api-testing.md): ${entryString}`,
      );
    }
  }

  for (const entry of allEntries) {
    const entryString = String(entry);
    if (!entryString.endsWith('.routes.ts')) continue;
    const routesPath = join(domainPath, entryString);
    const routesContent = readFileSync(routesPath, 'utf-8');
    if (
      (routesContent.includes('app.get') ||
        routesContent.includes('app.post') ||
        routesContent.includes('app.patch') ||
        routesContent.includes('app.put') ||
        routesContent.includes('app.delete')) &&
      !(routesContent.includes('create') && routesContent.includes('Controller'))
    ) {
      result.warnings.push(`${entryString} registers HTTP routes but may lack a controller import`);
    }
  }

  return result;
}

function main() {
  const strictMode = process.argv.includes('--strict');
  const targetDomain = process.argv.slice(2).find((argument) => !argument.startsWith('-'));

  const domains = targetDomain
    ? [targetDomain]
    : readdirSync(DOMAINS_DIR).filter((name) => {
        try {
          return require('node:fs').statSync(join(DOMAINS_DIR, name)).isDirectory();
        } catch {
          return false;
        }
      });

  let hasErrors = false;

  for (const domain of domains) {
    const result = validateDomain(domain);

    if (result.errors.length > 0) {
      hasErrors = true;
      console.error(`\n❌ ${result.domain}:`);
      for (const error of result.errors) {
        console.error(`   - ${error}`);
      }
    } else {
      console.log(`✅ ${result.domain}`);
    }

    for (const warning of result.warnings) {
      if (strictMode) {
        hasErrors = true;
        console.error(`   - ${warning}`);
      } else {
        console.warn(`   ⚠ ${warning}`);
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
