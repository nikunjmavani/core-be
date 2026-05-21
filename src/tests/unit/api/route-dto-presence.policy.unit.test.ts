/**
 * Policy: every HTTP route registration file has a co-located *.dto.ts, and parent routes
 * that mount sub-domain controllers must have a matching *.dto.ts in that sub-domain folder.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

const ROUTE_REGISTRAR_ONLY = new Set([
  'src/domains/billing/billing.routes.ts',
  'src/domains/tenancy/tenancy.routes.ts',
  'src/domains/notify/notify.routes.ts',
]);

function collectRouteFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectRouteFiles(fullPath, collected);
      continue;
    }
    if (entry.endsWith('.routes.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function relativePath(absolutePath: string): string {
  return absolutePath.replace(`${PROJECT_ROOT}/`, '');
}

function expectedDtoPath(routeFilePath: string): string {
  const directory = dirname(routeFilePath);
  const resourceBase = basename(routeFilePath).replace(/\.routes\.ts$/, '');
  return join(directory, `${resourceBase}.dto.ts`);
}

describe('route DTO presence policy', () => {
  const routeFiles = collectRouteFiles(DOMAINS_ROOT);

  it('requires co-located <resource>.dto.ts for every routes file that registers handlers', () => {
    const missing: string[] = [];

    for (const absolutePath of routeFiles) {
      const relative = relativePath(absolutePath);
      if (ROUTE_REGISTRAR_ONLY.has(relative)) {
        continue;
      }

      const source = readFileSync(absolutePath, 'utf8');
      if (!/\.(get|post|put|patch|delete)\s*\(/.test(source)) {
        continue;
      }

      const dtoPath = expectedDtoPath(absolutePath);
      if (!statSync(dtoPath, { throwIfNoEntry: false })) {
        missing.push(`${relative} → ${relativePath(dtoPath)}`);
      }
    }

    expect(
      missing.filter((entry) => !entry.includes('stripe-webhook/stripe-webhook.dto.ts')),
    ).toEqual([]);
  });

  it('requires sub-domain dto when parent routes import a sub-domain controller', () => {
    const missing: string[] = [];

    for (const absolutePath of routeFiles) {
      const source = readFileSync(absolutePath, 'utf8');
      const controllerImports = source.matchAll(
        /sub-domains\/([a-z0-9-]+)\/([a-z0-9-]+)\.controller/g,
      );

      for (const match of controllerImports) {
        const subDomainFolder = match[1];
        const controllerStem = match[2];
        if (!(subDomainFolder && controllerStem)) {
          continue;
        }
        const dtoPath = join(
          dirname(absolutePath),
          'sub-domains',
          subDomainFolder,
          `${controllerStem}.dto.ts`,
        );

        if (!statSync(dtoPath, { throwIfNoEntry: false })) {
          missing.push(`${relativePath(absolutePath)} → ${relativePath(dtoPath)}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
