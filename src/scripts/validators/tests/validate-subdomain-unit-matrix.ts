/**
 * Ensures each sub-domain resource folder has required unit test files per layer.
 * Usage: pnpm validate:domain:unit-matrix
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const DOMAINS_DIR = resolve(process.cwd(), 'src/domains');
const FLAT_DOMAINS = new Set(['audit', 'upload']);

const EXEMPT_RESOURCES = new Set([
  'user-data-export',
  'auth-mfa-session',
  'member-role-permission',
  'organization-api-key',
  'organization-settings',
  'organization-notification-policy',
]);

/** Layers allowed without a dedicated *.layer.unit.test.ts when other coverage exists. */
const OPTIONAL_LAYERS_WITHOUT_UNIT = new Set(['serializer', 'validator']);

/** Nested implementation modules (not top-level API resources). */
const EXEMPT_NESTED_IMPLEMENTATION = new Set(['verification-token']);

const OPTIONAL_REPOSITORY_UNIT_WHEN_DB_EXISTS = true;

/** Workers allowed without unit/integration test (retention, infra processors). */
const WORKER_TEST_ALLOWLIST = new Set([
  'audit-retention.worker.ts',
  'session-cleanup.worker.ts',
  'notification-retention.worker.ts',
  'stripe-webhook-event-retention.worker.ts',
  'stripe-webhook-event-reclaim.worker.ts',
  'stripe-webhook.worker.ts',
  'notification.worker.ts',
  'upload-tombstone-retention.worker.ts',
  'upload-pending-sweep.worker.ts',
  'webhook-tombstone-retention.worker.ts',
  'membership-tombstone-retention.worker.ts',
  'member-role-tombstone-retention.worker.ts',
  'organization-tombstone-retention.worker.ts',
  'organization-api-key-tombstone-retention.worker.ts',
  'organization-notification-policy-tombstone-retention.worker.ts',
]);

const LAYER_FILES = ['validator', 'serializer', 'controller', 'service', 'repository'] as const;

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
}

function isWorkerExempt(workerFileName: string): boolean {
  return WORKER_TEST_ALLOWLIST.has(workerFileName);
}

function checkEmitUnitTests(ownerPath: string, unitPath: string, errors: string[]): void {
  const eventsPath = join(ownerPath, 'events');
  if (!existsSync(eventsPath)) return;

  const eventUnitPath = join(unitPath, 'events');
  const eventUnitFiles = existsSync(eventUnitPath) ? listFiles(eventUnitPath) : [];

  for (const fileName of listFiles(eventsPath)) {
    if (!fileName.endsWith('-emit.ts')) continue;
    const expectedTest = fileName.replace('.ts', '.unit.test.ts');
    if (!eventUnitFiles.includes(expectedTest)) {
      errors.push(
        `Missing ${join('__tests__/unit/events', expectedTest)} for ${join(ownerPath, 'events', fileName).replace(`${process.cwd()}/`, '')}`,
      );
    }
  }
}

function checkDomainRootWorkers(domainPath: string, errors: string[]): void {
  const workersPath = join(domainPath, 'workers');
  if (!existsSync(workersPath)) return;

  const unitPath = join(domainPath, '__tests__', 'unit');
  const workerUnitPath = join(unitPath, 'events', 'worker');
  const workerUnitFiles = existsSync(workerUnitPath) ? listFiles(workerUnitPath) : [];

  for (const fileName of listFiles(workersPath)) {
    if (!fileName.includes('worker')) continue;
    if (isWorkerExempt(fileName)) continue;
    if (hasWorkerCoverage(domainPath, fileName)) continue;
    if (hasProcessorUnitTestCoverage(domainPath, fileName)) continue;

    const workerStem = fileName.replace(/\.worker\.ts$/, '').replace(/\.ts$/, '');
    const unitTest = `${workerStem}.worker.unit.test.ts`;
    if (!workerUnitFiles.includes(unitTest)) {
      errors.push(
        `Missing ${join('__tests__/unit/events/worker', unitTest)} for ${join(workersPath, fileName).replace(`${process.cwd()}/`, '')}`,
      );
    }
  }
}

function hasWorkerCoverage(ownerPath: string, workerFileName: string): boolean {
  const workerBase = workerFileName.replace('.ts', '').replace('.worker', '');
  const integrationPath = join(ownerPath, '__tests__', 'integration');
  if (!existsSync(integrationPath)) return false;
  const integrationFiles = listFiles(integrationPath);
  return integrationFiles.some((fileName) => fileName.includes(workerBase));
}

function hasProcessorUnitTestCoverage(ownerPath: string, workerFileName: string): boolean {
  const stem = workerFileName.replace(/\.worker\.ts$/, '').replace(/\.ts$/, '');
  return existsSync(join(ownerPath, '__tests__', 'unit', `${stem}.processor.unit.test.ts`));
}

function checkResourceOwner(ownerPath: string, resourceName: string, errors: string[]): void {
  if (EXEMPT_RESOURCES.has(resourceName) || EXEMPT_NESTED_IMPLEMENTATION.has(resourceName)) return;

  const unitPath = join(ownerPath, '__tests__', 'unit');
  const unitFiles = existsSync(unitPath) ? listFiles(unitPath) : [];

  for (const layer of LAYER_FILES) {
    const sourceFile = join(ownerPath, `${resourceName}.${layer}.ts`);
    if (!existsSync(sourceFile)) continue;

    const expectedTest = `${resourceName}.${layer}.unit.test.ts`;
    const hasTest = unitFiles.includes(expectedTest);

    if (layer === 'repository' && OPTIONAL_REPOSITORY_UNIT_WHEN_DB_EXISTS) {
      const dbTest = `${resourceName}.repository.db.unit.test.ts`;
      if (unitFiles.includes(dbTest)) continue;
    }

    if (layer === 'repository' && unitFiles.includes(`${resourceName}.service.unit.test.ts`)) {
      continue;
    }

    if (
      layer === 'service' &&
      unitFiles.includes(`${resourceName}.controller.unit.test.ts`) &&
      unitFiles.includes(`${resourceName}.repository.db.unit.test.ts`)
    ) {
      continue;
    }

    if (OPTIONAL_LAYERS_WITHOUT_UNIT.has(layer)) {
      continue;
    }

    if (layer === 'controller' && unitFiles.includes(`${resourceName}.service.unit.test.ts`)) {
      continue;
    }

    if (!hasTest) {
      errors.push(`Missing ${expectedTest} for ${sourceFile.replace(`${process.cwd()}/`, '')}`);
    }

    if (layer === 'repository' && existsSync(join(ownerPath, `${resourceName}.schema.ts`))) {
      const dbTest = `${resourceName}.repository.db.unit.test.ts`;
      if (!unitFiles.includes(dbTest)) {
        errors.push(
          `Missing ${dbTest} (schema exists) under ${unitPath.replace(`${process.cwd()}/`, '')}`,
        );
      }
    }
  }

  if (existsSync(join(ownerPath, 'events', '__tests__'))) {
    errors.push(`Forbidden events/__tests__/ under ${ownerPath.replace(`${process.cwd()}/`, '')}`);
  }

  checkEmitUnitTests(ownerPath, unitPath, errors);

  const workersPath = join(ownerPath, 'workers');
  if (existsSync(workersPath)) {
    for (const fileName of listFiles(workersPath)) {
      if (!fileName.includes('worker')) continue;
      if (isWorkerExempt(fileName)) continue;
      if (hasWorkerCoverage(ownerPath, fileName)) continue;
      if (hasProcessorUnitTestCoverage(ownerPath, fileName)) continue;

      const workerStem = fileName.replace(/\.worker\.ts$/, '').replace(/\.ts$/, '');
      const workerUnitPath = join(unitPath, 'events', 'worker');
      const workerUnitFiles = existsSync(workerUnitPath) ? listFiles(workerUnitPath) : [];
      const unitTest = `${workerStem}.worker.unit.test.ts`;
      if (!workerUnitFiles.includes(unitTest)) {
        errors.push(
          `Missing worker unit/integration test for ${join(workersPath, fileName).replace(`${process.cwd()}/`, '')}`,
        );
      }
    }
  }
}

function checkImplementationOnlyOwner(ownerPath: string, errors: string[]): void {
  const unitPath = join(ownerPath, '__tests__', 'unit');
  checkEmitUnitTests(ownerPath, unitPath, errors);

  const workersPath = join(ownerPath, 'workers');
  if (!existsSync(workersPath)) return;

  const workerUnitPath = join(unitPath, 'events', 'worker');
  const workerUnitFiles = existsSync(workerUnitPath) ? listFiles(workerUnitPath) : [];

  for (const fileName of listFiles(workersPath)) {
    if (!fileName.includes('worker')) continue;
    if (isWorkerExempt(fileName)) continue;
    if (hasWorkerCoverage(ownerPath, fileName)) continue;
    if (hasProcessorUnitTestCoverage(ownerPath, fileName)) continue;

    const workerStem = fileName.replace(/\.worker\.ts$/, '').replace(/\.ts$/, '');
    const unitTest = `${workerStem}.worker.unit.test.ts`;
    if (!workerUnitFiles.includes(unitTest)) {
      errors.push(
        `Missing worker unit/integration test for ${join(workersPath, fileName).replace(`${process.cwd()}/`, '')}`,
      );
    }
  }
}

function walkSubDomains(domainPath: string, errors: string[]): void {
  const subDomainsPath = join(domainPath, 'sub-domains');
  if (!existsSync(subDomainsPath)) return;

  const walk = (directory: string) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const hasService = entries.some(
      (entry) => entry.isFile() && entry.name.endsWith('.service.ts'),
    );
    const hasWorkers = entries.some((entry) => entry.isDirectory() && entry.name === 'workers');
    const hasEvents = entries.some((entry) => entry.isDirectory() && entry.name === 'events');
    if (hasService) {
      const resourceName = basename(directory);
      checkResourceOwner(directory, resourceName, errors);
    } else if (hasWorkers || hasEvents) {
      checkImplementationOnlyOwner(directory, errors);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'events') {
        walk(join(directory, entry.name));
      }
    }
  };

  walk(subDomainsPath);
}

function main(): void {
  const errors: string[] = [];

  for (const domainName of readdirSync(DOMAINS_DIR)) {
    const domainPath = join(DOMAINS_DIR, domainName);
    if (!existsSync(domainPath)) continue;

    if (FLAT_DOMAINS.has(domainName)) {
      checkResourceOwner(domainPath, domainName, errors);
      checkDomainRootWorkers(domainPath, errors);
      continue;
    }

    walkSubDomains(domainPath, errors);
    checkDomainRootWorkers(domainPath, errors);
  }

  if (errors.length > 0) {
    console.error('validate-subdomain-unit-matrix failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log('✅ validate-subdomain-unit-matrix passed');
}

main();
