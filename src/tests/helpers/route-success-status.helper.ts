import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Map of `"METHOD /full/path"` catalog keys to the route's documented success
 * status code (the single 2xx the controller emits on the happy path).
 */
export type RouteSuccessStatusMap = Record<string, number>;

/**
 * Success statuses controllers are allowed to declare. Anything outside this
 * set in the committed map fails `pnpm validate:route-success-statuses`.
 */
export const ALLOWED_SUCCESS_STATUSES: ReadonlySet<number> = new Set([200, 201, 202, 204]);

const ROUTE_SUCCESS_STATUS_PATH = join(
  process.cwd(),
  'tooling',
  'openapi',
  'route-catalog',
  'route-success-statuses.json',
);

/**
 * Builds the canonical lookup key for a catalog route (`"METHOD /full/path"`),
 * matching the key format of `route-success-statuses.json`.
 */
export function routeSuccessStatusKey(options: { method: string; path: string }): string {
  return `${options.method.toUpperCase()} ${options.path}`;
}

/**
 * Loads the committed per-route success-status map
 * (`tooling/openapi/route-catalog/route-success-statuses.json`).
 *
 * The map is the source of truth for each route's documented happy-path
 * status; `pnpm validate:route-success-statuses` keeps it in exact sync with
 * `docs/routes.txt`, and the observed-coverage gate fails when runtime
 * behavior contradicts a declared status.
 */
export function loadRouteSuccessStatusMap(
  mapPath: string = ROUTE_SUCCESS_STATUS_PATH,
): RouteSuccessStatusMap {
  return JSON.parse(readFileSync(mapPath, 'utf-8')) as RouteSuccessStatusMap;
}

/**
 * Returns the declared success status for a catalog route. Throws when the
 * route is missing from the map — the sync gate guarantees presence for every
 * catalog route, so a throw here means the map is stale.
 */
export function getDeclaredSuccessStatus(options: {
  method: string;
  path: string;
  map?: RouteSuccessStatusMap;
}): number {
  const map = options.map ?? loadRouteSuccessStatusMap();
  const key = routeSuccessStatusKey(options);
  const status = map[key];
  if (status === undefined) {
    throw new Error(
      `No declared success status for "${key}" — run pnpm validate:route-success-statuses and update tooling/openapi/route-catalog/route-success-statuses.json`,
    );
  }
  return status;
}
