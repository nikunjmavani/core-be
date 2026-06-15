/**
 * Success-status map sync gate.
 *
 * Verifies `tooling/openapi/route-catalog/route-success-statuses.json` stays in
 * exact sync with `docs/routes.txt`:
 *   - every catalog route has exactly one declared success status,
 *   - no stale entries for routes that left the catalog,
 *   - every declared status is one of 200 / 201 / 202 / 204.
 *
 * The map documents each route's happy-path status (controllers do not declare
 * `schema.response`, so this file is the source of truth). Runtime drift is
 * caught separately by `pnpm validate:route-success-coverage`, which compares
 * statuses observed during the full test run against the declared map.
 *
 * Usage: `pnpm validate:route-success-statuses`
 */
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  ALLOWED_SUCCESS_STATUSES,
  loadRouteSuccessStatusMap,
  routeSuccessStatusKey,
} from '@/tests/helpers/route-success-status.helper.js';

function main(): void {
  const registry = loadRouteRegistryFromCatalog();
  const successStatusMap = loadRouteSuccessStatusMap();

  const catalogKeys = new Set(registry.map((route) => routeSuccessStatusKey(route)));
  const mapKeys = new Set(Object.keys(successStatusMap));

  const missing = [...catalogKeys].filter((key) => !mapKeys.has(key)).sort();
  const stale = [...mapKeys].filter((key) => !catalogKeys.has(key)).sort();
  const invalid = Object.entries(successStatusMap)
    .filter(([, status]) => !ALLOWED_SUCCESS_STATUSES.has(status))
    .map(([key, status]) => `${key} → ${status}`)
    .sort();

  if (missing.length > 0 || stale.length > 0 || invalid.length > 0) {
    console.error('validate-route-success-statuses failed:\n');
    if (missing.length > 0) {
      console.error('Catalog routes missing a declared success status:');
      for (const key of missing) console.error(`  - ${key}`);
      console.error('');
    }
    if (stale.length > 0) {
      console.error('Stale map entries (route no longer in docs/routes.txt):');
      for (const key of stale) console.error(`  - ${key}`);
      console.error('');
    }
    if (invalid.length > 0) {
      console.error('Declared statuses outside the allowed set (200/201/202/204):');
      for (const line of invalid) console.error(`  - ${line}`);
      console.error('');
    }
    console.error(
      'Update tooling/openapi/route-catalog/route-success-statuses.json (one entry per catalog route).',
    );
    process.exit(1);
  }

  console.log(
    `✅ validate-route-success-statuses passed (${registry.length} routes, all declared)`,
  );
}

main();
