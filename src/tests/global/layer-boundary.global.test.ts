/**
 * Policy: enforce the CLAUDE.md "Dependency Rules" for the HTTP layers that
 * `service-cross-domain-boundary.global.test.ts` does not cover.
 *
 * - Controllers coordinate — they call services, never a repository, a Drizzle
 *   schema, or the database infrastructure directly.
 * - Route files register controllers — same forbids as controllers.
 * - Repositories own SQL — they never reach back up into services or controllers.
 * - Pure layers (dto / validator / serializer) never touch repositories, services,
 *   or the database infrastructure at runtime.
 *
 * Type-only imports (`import type { UploadRow } from './upload.repository.js'`)
 * are allowed everywhere: sharing a row TYPE is not a layering violation, only a
 * runtime dependency is. Every rule scans runtime imports.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

/** Recursively collects domain files matching one of the given suffixes (tests excluded). */
function collectFilesBySuffix(
  directory: string,
  suffixes: readonly string[],
  accumulator: string[] = [],
): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === '__tests__' || entry === 'seed') continue;
      collectFilesBySuffix(fullPath, suffixes, accumulator);
      continue;
    }
    if (suffixes.some((suffix) => entry.endsWith(suffix))) {
      accumulator.push(relative(PROJECT_ROOT, fullPath));
    }
  }
  return accumulator;
}

/**
 * Returns the runtime imports of a source file whose specifier matches the given
 * pattern. `import type … from` statements are skipped — only value imports count.
 */
function findRuntimeImports(source: string, specifierPattern: RegExp): string[] {
  const importStatement = /import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g;
  const offenders: string[] = [];
  for (const match of source.matchAll(importStatement)) {
    const isTypeOnly = match[1] !== undefined;
    const specifier = match[2];
    if (isTypeOnly || specifier === undefined) continue;
    if (specifierPattern.test(specifier)) {
      offenders.push(specifier);
    }
  }
  return offenders;
}

/** Scans every collected file and returns `file: specifier` violation lines. */
function scanLayer(suffixes: readonly string[], forbidden: RegExp): string[] {
  const violations: string[] = [];
  for (const filePath of collectFilesBySuffix(DOMAINS_ROOT, suffixes)) {
    const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
    for (const specifier of findRuntimeImports(source, forbidden)) {
      violations.push(`${filePath} → ${specifier}`);
    }
  }
  return violations;
}

const REPOSITORY_SCHEMA_OR_DATABASE =
  /(\.repository(\.js)?$)|(\.schema(\.js)?$)|@\/infrastructure\/database\//;

describe('Global: layer boundary (CLAUDE.md dependency rules)', () => {
  it('controllers never runtime-import repositories, schemas, or database infrastructure', () => {
    expect(scanLayer(['.controller.ts'], REPOSITORY_SCHEMA_OR_DATABASE)).toEqual([]);
  });

  it('route files never runtime-import repositories, schemas, or database infrastructure', () => {
    expect(scanLayer(['.routes.ts'], REPOSITORY_SCHEMA_OR_DATABASE)).toEqual([]);
  });

  it('repositories never import services or controllers (any import kind)', () => {
    // Even a type import of a service inside a repository inverts the layering —
    // repository row types must not depend on service shapes.
    const violations: string[] = [];
    const forbidden = /(\.service(\.js)?$)|(\.controller(\.js)?$)/;
    for (const filePath of collectFilesBySuffix(DOMAINS_ROOT, ['.repository.ts'])) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      const importStatement = /import\s+[^;]*?from\s+['"]([^'"]+)['"]/g;
      for (const match of source.matchAll(importStatement)) {
        const specifier = match[1];
        if (specifier !== undefined && forbidden.test(specifier)) {
          violations.push(`${filePath} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('pure layers (dto, validator, serializer) never runtime-import repositories, services, or database infrastructure', () => {
    const forbidden = /(\.repository(\.js)?$)|(\.service(\.js)?$)|@\/infrastructure\/database\//;
    expect(scanLayer(['.dto.ts', '.validator.ts', '.serializer.ts'], forbidden)).toEqual([]);
  });
});
