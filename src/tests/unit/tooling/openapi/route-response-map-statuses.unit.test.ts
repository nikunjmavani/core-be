import { describe, expect, it } from 'vitest';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  loadRouteSuccessStatusMap,
  routeSuccessStatusKey,
} from '@/tests/helpers/route-success-status.helper.js';
import { routeResponseMap } from '@tooling/openapi/response-map/index.js';

function toOpenApiKey(catalogKey: string): string {
  return catalogKey.replace(/:([A-Za-z]+)/g, '{$1}');
}

/**
 * OpenAPI response-map ⟷ success-status registry gate.
 *
 * The registry (runtime truth, enforced by the observed-status gate) is
 * authoritative for each route's happy-path status; the response map supplies
 * body schemas. This gate keeps the two from drifting and catches dead map
 * keys (a key that matches no catalog route silently falls back to a generic
 * 200 in the generated spec).
 */
describe('OpenAPI response map statuses', () => {
  const registry = loadRouteRegistryFromCatalog();
  const successStatusMap = loadRouteSuccessStatusMap();
  const catalogKeysOpenApi = new Set(
    registry.map((route) => toOpenApiKey(routeSuccessStatusKey(route))),
  );
  const declaredByOpenApiKey = new Map(
    Object.entries(successStatusMap).map(([key, status]) => [toOpenApiKey(key), status]),
  );

  it('has no dead keys — every response-map entry matches a catalog route', () => {
    const deadKeys = Object.keys(routeResponseMap).filter((key) => !catalogKeysOpenApi.has(key));
    expect(deadKeys, `Dead response-map keys (no catalog route):\n${deadKeys.join('\n')}`).toEqual(
      [],
    );
  });

  it('every response-map statusCode matches the declared success status', () => {
    const mismatches = Object.entries(routeResponseMap)
      .filter(([key, definition]) => {
        const declared = declaredByOpenApiKey.get(key);
        return declared !== undefined && definition.statusCode !== declared;
      })
      .map(
        ([key, definition]) =>
          `${key}: map=${definition.statusCode} registry=${declaredByOpenApiKey.get(key)}`,
      );
    expect(mismatches, `Status mismatches:\n${mismatches.join('\n')}`).toEqual([]);
  });

  it('204 entries carry no body schema', () => {
    const withBody = Object.entries(routeResponseMap)
      .filter(([, definition]) => definition.statusCode === 204 && definition.schema !== null)
      .map(([key]) => key);
    expect(withBody, `204 entries must have schema: null:\n${withBody.join('\n')}`).toEqual([]);
  });
});
