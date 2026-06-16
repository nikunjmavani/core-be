/**
 * Generates docs/routes.txt from domain route sources.
 * Run: pnpm routes:catalog
 * Check only: pnpm routes:catalog:check
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildCatalogContent } from '@tooling/openapi/route-catalog/catalog-formatter.js';
import { CATALOG_OUTPUT_PATH } from '@tooling/openapi/route-catalog/constants.js';
import { collectAllParsedRoutes } from '@tooling/openapi/route-catalog/route-parser.js';

export type {
  ParsedRoute,
  RegistryAccess,
  RouteAccess,
} from '@tooling/openapi/route-catalog/types.js';
export { classifyAccess } from '@tooling/openapi/route-catalog/access-classifier.js';
export {
  collectAllParsedRoutes,
  inferDomainSlug,
  inferSubDomain,
  inferSubDomainLabel,
  sortParsedRoutes,
  toRegistryAccess,
} from '@tooling/openapi/route-catalog/route-parser.js';
export {
  loadDomainPrefixMap,
  loadPermissionConstantMap,
} from '@tooling/openapi/route-catalog/prefix-map.js';
export {
  resolveOrgScope,
  TEAM_ONLY_ROUTE_KEYS,
} from '@tooling/openapi/route-catalog/org-scope.js';

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const allRoutes = collectAllParsedRoutes();
  const catalogContent = buildCatalogContent(allRoutes);

  if (checkOnly) {
    const existingCatalog = readFileSync(CATALOG_OUTPUT_PATH, 'utf-8');
    if (existingCatalog !== catalogContent) {
      console.error(
        'Route catalog out of sync (docs/routes.txt). Run pnpm routes:catalog and commit.',
      );
      process.exit(1);
    }

    console.log('docs/routes.txt is in sync with route sources.');
    return;
  }

  mkdirSync(dirname(CATALOG_OUTPUT_PATH), { recursive: true });
  writeFileSync(CATALOG_OUTPUT_PATH, catalogContent, 'utf-8');
  console.log(`Wrote ${allRoutes.length} routes to ${CATALOG_OUTPUT_PATH}`);
}

main();
