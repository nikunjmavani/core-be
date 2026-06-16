/**
 * Org-scope map sync gate.
 *
 * Verifies `tooling/openapi/route-catalog/route-org-scope.json` stays in exact
 * sync with `docs/routes.txt`:
 *   - every catalog route has exactly one declared org scope,
 *   - no stale entries for routes that left the catalog,
 *   - every declared scope is `both` or `team`.
 *
 * The map drives the catalog's `O` column (`both` = works for any org; `team` =
 * rejects a personal org with 422). It is the source of truth — a `team` entry
 * should correspond to a route guarded by `assertTeamOrganization(...)`.
 *
 * Usage: `pnpm validate:route-org-scope`
 */
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  ALLOWED_ORG_SCOPES,
  loadRouteOrgScopeMap,
  routeOrgScopeKey,
} from '@/tests/helpers/route-org-scope.helper.js';

function main(): void {
  const registry = loadRouteRegistryFromCatalog();
  const orgScopeMap = loadRouteOrgScopeMap();

  const catalogKeys = new Set(registry.map((route) => routeOrgScopeKey(route)));
  const mapKeys = new Set(Object.keys(orgScopeMap));

  const missing = [...catalogKeys].filter((key) => !mapKeys.has(key)).sort();
  const stale = [...mapKeys].filter((key) => !catalogKeys.has(key)).sort();
  const invalid = Object.entries(orgScopeMap)
    .filter(([, scope]) => !ALLOWED_ORG_SCOPES.has(scope))
    .map(([key, scope]) => `${key} → ${scope}`)
    .sort();

  if (missing.length > 0 || stale.length > 0 || invalid.length > 0) {
    console.error('validate-route-org-scope failed:\n');
    if (missing.length > 0) {
      console.error('Catalog routes missing a declared org scope:');
      for (const key of missing) console.error(`  - ${key}`);
      console.error('');
    }
    if (stale.length > 0) {
      console.error('Stale map entries (route no longer in docs/routes.txt):');
      for (const key of stale) console.error(`  - ${key}`);
      console.error('');
    }
    if (invalid.length > 0) {
      console.error('Declared scopes outside the allowed set (both/team):');
      for (const line of invalid) console.error(`  - ${line}`);
      console.error('');
    }
    console.error(
      'Update tooling/openapi/route-catalog/route-org-scope.json (one entry per catalog route).',
    );
    process.exit(1);
  }

  console.log(`✅ validate-route-org-scope passed (${registry.length} routes, all annotated)`);
}

main();
