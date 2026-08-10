/**
 * Policy: container assembly happens once at boot through `domainContainersPlugin`.
 *
 * Domain containers register via `register<Domain>Container` in each `*.container.ts`
 * module; `domain-containers.plugin.ts` is the sole composition root that invokes them.
 * Runtime `attach*Dependencies` monkey-patches are forbidden.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = join(PROJECT_ROOT, 'src');

const SKIP_DIRECTORIES = new Set(['__tests__', 'tests', 'node_modules']);

function collectSourceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectSourceFiles(fullPath, accumulator);
      continue;
    }
    if (extname(entry) === '.ts' && !entry.endsWith('.d.ts')) {
      accumulator.push(fullPath);
    }
  }
  return accumulator;
}

const SOURCE_FILES = collectSourceFiles(SRC_ROOT);

const DOMAIN_CONTAINER_KEYS = [
  'userDomain',
  'tenancyDomain',
  'auditDomain',
  'authDomain',
  'billingDomain',
  'notifyDomain',
  'uploadDomain',
] as const;

const COMPOSITION_ROOT_RELATIVE_PATH = 'src/domains/domain-containers.plugin.ts';

const REGISTER_CONTAINER_PATTERN =
  /\bexport\s+function\s+register(?:User|Tenancy|Auth|Audit|Billing|Notify|Upload)Container\b/;

function isDomainContainerModule(relativePath: string): boolean {
  return relativePath.endsWith('.container.ts');
}

describe('Policy: composition root is the only place that decorates domain containers', () => {
  it('no source file defines or calls `attach*Dependencies`', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const contents = readFileSync(file, 'utf8');
      if (/\battach[A-Z]\w*Dependencies\b/.test(contents)) {
        offenders.push(relative(PROJECT_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('`register<Domain>Container` is exported only from domain container modules', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const contents = readFileSync(file, 'utf8');
      const relativePath = relative(PROJECT_ROOT, file);
      if (REGISTER_CONTAINER_PATTERN.test(contents) && !isDomainContainerModule(relativePath)) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(DOMAIN_CONTAINER_KEYS)(
    'decorates `%s` only from domain container modules',
    (domainKey) => {
      // eslint-disable-next-line security/detect-non-literal-regexp -- pattern built from typed DOMAIN_CONTAINER_KEYS constants.
      const pattern = new RegExp(`\\.decorate\\(\\s*['"]${domainKey}['"]`);
      const decorators: string[] = [];
      for (const file of SOURCE_FILES) {
        const contents = readFileSync(file, 'utf8');
        if (pattern.test(contents)) {
          decorators.push(relative(PROJECT_ROOT, file));
        }
      }
      expect(decorators.length).toBeGreaterThan(0);
      expect(decorators.every(isDomainContainerModule)).toBe(true);
    },
  );

  it('domain-containers.plugin.ts registers every domain container', () => {
    const contents = readFileSync(join(PROJECT_ROOT, COMPOSITION_ROOT_RELATIVE_PATH), 'utf8');
    const registerCalls = [
      'registerUserContainer(application)',
      'registerTenancyContainer(application)',
      'registerAuditContainer(application)',
      'registerAuthContainer(application)',
      'registerBillingContainer(application)',
      'registerNotifyContainer(application)',
      'registerUploadContainer(application)',
    ];
    for (const registerCall of registerCalls) {
      expect(contents).toContain(registerCall);
    }
  });
});
