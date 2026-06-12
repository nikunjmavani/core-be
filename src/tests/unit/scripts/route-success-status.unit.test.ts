import { describe, expect, it } from 'vitest';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import { buildRouteSmokeCases } from '@/tests/helpers/route-http-coverage.helper.js';
import {
  ALLOWED_SUCCESS_STATUSES,
  getDeclaredSuccessStatus,
  loadRouteSuccessStatusMap,
  routeSuccessStatusKey,
} from '@/tests/helpers/route-success-status.helper.js';

/**
 * Success-status map guard — keeps tooling/openapi/route-catalog/route-success-statuses.json
 * in exact sync with docs/routes.txt and pins known non-200 happy paths.
 */
describe('route success-status map', () => {
  const registry = loadRouteRegistryFromCatalog();
  const successStatusMap = loadRouteSuccessStatusMap();

  it('declares exactly one success status for every catalog route', () => {
    const catalogKeys = new Set(registry.map((route) => routeSuccessStatusKey(route)));
    const mapKeys = new Set(Object.keys(successStatusMap));

    const missing = [...catalogKeys].filter((key) => !mapKeys.has(key));
    const stale = [...mapKeys].filter((key) => !catalogKeys.has(key));

    expect(missing, `Catalog routes missing from map:\n${missing.join('\n')}`).toEqual([]);
    expect(stale, `Stale map entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('only uses allowed success statuses (200/201/202/204)', () => {
    const invalid = Object.entries(successStatusMap).filter(
      ([, status]) => !ALLOWED_SUCCESS_STATUSES.has(status),
    );
    expect(invalid, `Invalid statuses: ${JSON.stringify(invalid)}`).toEqual([]);
  });

  it('pins documented non-200 happy paths', () => {
    expect(successStatusMap['POST /api/v1/auth/logout']).toBe(204);
    expect(successStatusMap['DELETE /api/v1/auth/me/sessions']).toBe(204);
    expect(successStatusMap['POST /api/v1/tenancy/organizations']).toBe(201);
    expect(successStatusMap['POST /api/v1/uploads']).toBe(201);
    expect(
      successStatusMap['POST /api/v1/tenancy/organizations/:id/api-keys/:apiKeyId/rotate'],
    ).toBe(201);
    expect(successStatusMap['POST /api/v1/users/me/data-export']).toBe(202);
  });

  it('pins documented 200 happy paths for reads and token flows', () => {
    expect(successStatusMap['POST /api/v1/auth/login']).toBe(200);
    expect(successStatusMap['GET /api/v1/users/me']).toBe(200);
    expect(successStatusMap['GET /readyz']).toBe(200);
  });

  it('buildRouteSmokeCases carries the declared success status for every catalog route', () => {
    for (const route of registry) {
      const smokeCase = buildRouteSmokeCases(route, 'org-public-id-placeholder');
      expect(
        smokeCase.expectSuccess,
        `${route.method} ${route.path} expectSuccess should match the declared map entry`,
      ).toBe(successStatusMap[routeSuccessStatusKey(route)]);
    }
  });

  it('getDeclaredSuccessStatus resolves catalog routes and rejects unknown ones', () => {
    expect(getDeclaredSuccessStatus({ method: 'POST', path: '/api/v1/auth/logout' })).toBe(204);
    expect(() =>
      getDeclaredSuccessStatus({ method: 'GET', path: '/api/v1/does-not-exist' }),
    ).toThrow(/No declared success status/);
  });
});
