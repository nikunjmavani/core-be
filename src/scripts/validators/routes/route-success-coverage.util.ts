import type { RouteEntry } from '@/tests/helpers/route-catalog-registry.js';
import {
  routeSuccessStatusKey,
  type RouteSuccessStatusMap,
} from '@/tests/helpers/route-success-status.helper.js';

/**
 * Catalog routes exempt from declared-vs-observed drift checks.
 *
 * Each entry must be justified. MCP routes hijack the raw response
 * (`reply.hijack()`), so observed statuses follow the MCP streamable HTTP
 * spec (e.g. 400/405 handshakes) rather than the declared catalog happy path.
 */
export const ROUTE_SUCCESS_DRIFT_EXEMPT_KEYS: ReadonlySet<string> = new Set([
  'GET /api/v1/mcp',
  'POST /api/v1/mcp',
]);

/** Outcome of evaluating observed route statuses against the declared success map. */
export type RouteSuccessCoverageResult = {
  /** Catalog keys whose declared success status was observed at least once. */
  coveredRoutes: string[];
  /** Catalog keys whose declared success status was never observed. */
  uncoveredRoutes: string[];
  /** Human-readable declared-vs-observed contradictions (hard failures). */
  driftFailures: string[];
  /** Distinct observation lines that matched a catalog route. */
  observedCatalogLineCount: number;
};

function parseObservedLine(line: string): { key: string; statusCode: number } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const segments = trimmed.split(' ');
  if (segments.length !== 3) {
    return null;
  }
  const [method, rawRouteUrl, rawStatus] = segments;
  const statusCode = Number(rawStatus);
  if (!(method && rawRouteUrl && Number.isInteger(statusCode))) {
    return null;
  }
  // Fastify registers prefix-root routes with a trailing slash; catalog paths have none.
  const routeUrl =
    rawRouteUrl.length > 1 && rawRouteUrl.endsWith('/') ? rawRouteUrl.slice(0, -1) : rawRouteUrl;
  return { key: `${method.toUpperCase()} ${routeUrl}`, statusCode };
}

/**
 * Evaluates observed `"METHOD /route/pattern status"` lines against the
 * declared success-status map for every catalog route.
 *
 * A route is **covered** when its declared status was observed. A **drift
 * failure** is an observed 2xx/3xx on a catalog route that differs from the
 * declared status — either the map entry is wrong or the controller changed
 * its happy-path status without updating the map.
 */
export function evaluateRouteSuccessCoverage(options: {
  registry: RouteEntry[];
  successStatusMap: RouteSuccessStatusMap;
  observedLines: string[];
  driftExemptKeys?: ReadonlySet<string>;
}): RouteSuccessCoverageResult {
  const driftExemptKeys = options.driftExemptKeys ?? ROUTE_SUCCESS_DRIFT_EXEMPT_KEYS;

  const observedStatusesByKey = new Map<string, Set<number>>();
  for (const line of options.observedLines) {
    const parsed = parseObservedLine(line);
    if (!parsed) {
      continue;
    }
    const statuses = observedStatusesByKey.get(parsed.key) ?? new Set<number>();
    statuses.add(parsed.statusCode);
    observedStatusesByKey.set(parsed.key, statuses);
  }

  const coveredRoutes: string[] = [];
  const uncoveredRoutes: string[] = [];
  const driftFailures: string[] = [];
  let observedCatalogLineCount = 0;

  for (const route of options.registry) {
    const key = routeSuccessStatusKey(route);
    const declaredStatus = options.successStatusMap[key];
    const observedStatuses = observedStatusesByKey.get(key);

    if (declaredStatus === undefined) {
      // validate:route-success-statuses owns map completeness; skip here.
      continue;
    }
    if (!observedStatuses) {
      uncoveredRoutes.push(key);
      continue;
    }

    observedCatalogLineCount += observedStatuses.size;

    const successObservations = [...observedStatuses].filter(
      (status) => status >= 200 && status < 400,
    );
    if (!driftExemptKeys.has(key)) {
      for (const status of successObservations) {
        // 304 Not Modified is the protocol-level conditional variant of a
        // cacheable GET's 200 (ETag / If-None-Match) — an alternate success,
        // never drift. Coverage still requires observing the declared status.
        if (status === 304) {
          continue;
        }
        if (status !== declaredStatus) {
          driftFailures.push(
            `${key}: declared ${declaredStatus} but observed ${status} — update tooling/openapi/route-catalog/route-success-statuses.json or fix the controller`,
          );
        }
      }
    }

    if (successObservations.includes(declaredStatus)) {
      coveredRoutes.push(key);
    } else {
      uncoveredRoutes.push(key);
    }
  }

  return {
    coveredRoutes: coveredRoutes.sort(),
    uncoveredRoutes: uncoveredRoutes.sort(),
    driftFailures: driftFailures.sort(),
    observedCatalogLineCount,
  };
}
