/**
 * Policy: domain services depend on {@link ObjectStoragePort}, not storage.service or AWS SDK.
 * Backs plan #55 (`p2-storage-port`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

const TARGET_SERVICE_FILES = [
  'src/domains/user/user.service.ts',
  'src/domains/tenancy/sub-domains/organization/organization.service.ts',
  'src/domains/upload/upload.service.ts',
] as const;

function collectServiceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectServiceFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.service.ts')) {
      accumulator.push(relative(PROJECT_ROOT, fullPath));
    }
  }
  return accumulator;
}

const ALL_DOMAIN_SERVICE_FILES = collectServiceFiles(DOMAINS_ROOT);

describe('Policy: domain services use ObjectStoragePort injection', () => {
  it.each(
    TARGET_SERVICE_FILES,
  )('%s imports ObjectStoragePort and not storage.service', (servicePath) => {
    const source = readFileSync(join(PROJECT_ROOT, servicePath), 'utf8');
    expect(source).toMatch(/ObjectStoragePort/);
    expect(source).not.toMatch(/from\s+['"]@\/infrastructure\/storage\/storage\.service/);
    expect(source).not.toMatch(/from\s+['"]@aws-sdk\//);
  });

  it('no domain *.service.ts imports @aws-sdk', () => {
    const offenders = ALL_DOMAIN_SERVICE_FILES.filter((servicePath) => {
      const source = readFileSync(join(PROJECT_ROOT, servicePath), 'utf8');
      return /from\s+['"]@aws-sdk\//.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('no domain *.service.ts imports storage.service facade', () => {
    const offenders = ALL_DOMAIN_SERVICE_FILES.filter((servicePath) => {
      const source = readFileSync(join(PROJECT_ROOT, servicePath), 'utf8');
      return /from\s+['"]@\/infrastructure\/storage\/storage\.service/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
