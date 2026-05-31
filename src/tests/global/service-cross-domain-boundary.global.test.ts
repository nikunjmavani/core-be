/**
 * Policy: domain services may use their own domain's repositories and other domains'
 * services only — never another domain's repository or schema for direct DB access.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

function collectServiceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === '__tests__') continue;
      collectServiceFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.service.ts')) {
      accumulator.push(relative(PROJECT_ROOT, fullPath));
    }
  }
  return accumulator;
}

function resolveOwningDomain(serviceFilePath: string): string | null {
  const match = serviceFilePath.match(/^src\/domains\/([^/]+)\//);
  return match?.[1] ?? null;
}

function findCrossDomainLayerImports(
  source: string,
  owningDomain: string,
  layer: 'repository' | 'schema',
): string[] {
  const importPattern = new RegExp(
    String.raw`from\s+['"]@/domains/([^/'"]+)(?:/[^'"]*)?/${layer}(?:\.js)?['"]`,
    'g',
  );
  const offenders: string[] = [];
  for (const match of source.matchAll(importPattern)) {
    const importedDomain = match[1];
    if (importedDomain !== owningDomain) {
      offenders.push(match[0]);
    }
  }
  return offenders;
}

describe('Policy: service cross-domain boundary', () => {
  const serviceFiles = collectServiceFiles(DOMAINS_ROOT);

  it('every domain *.service.ts uses only same-domain repositories (never other domains)', () => {
    const violations: string[] = [];

    for (const filePath of serviceFiles) {
      const owningDomain = resolveOwningDomain(filePath);
      if (owningDomain === null) continue;

      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      const repositoryImports = findCrossDomainLayerImports(source, owningDomain, 'repository');
      if (repositoryImports.length > 0) {
        violations.push(`${filePath}: ${repositoryImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('every domain *.service.ts does not import other domains schemas for direct DB access', () => {
    const violations: string[] = [];

    for (const filePath of serviceFiles) {
      const owningDomain = resolveOwningDomain(filePath);
      if (owningDomain === null) continue;

      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      const schemaImports = findCrossDomainLayerImports(source, owningDomain, 'schema');
      if (schemaImports.length > 0) {
        violations.push(`${filePath}: ${schemaImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
