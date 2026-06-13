import { describe, it, expect } from 'vitest';
import {
  loadProtectedRoutesFromCatalog,
  materializeRouteCatalogPath,
} from '@/tests/helpers/route-catalog-auth.js';

describe('route-catalog-auth', () => {
  it('materializeRouteCatalogPath replaces path parameters', () => {
    expect(
      materializeRouteCatalogPath('/api/v1/tenancy/organization/memberships/:membership_id'),
    ).toBe('/api/v1/tenancy/organization/memberships/000000000000000000000');
  });

  it('loadProtectedRoutesFromCatalog includes AUTH and PERM routes', () => {
    const routes = loadProtectedRoutesFromCatalog();
    expect(
      routes.some((route) => route.path === '/api/v1/users/me' && route.access === 'AUTH'),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path === '/api/v1/tenancy/organization/settings' && route.access === 'PERM',
      ),
    ).toBe(true);
  });

  it('loadProtectedRoutesFromCatalog excludes PUBLIC routes', () => {
    const routes = loadProtectedRoutesFromCatalog();
    expect(routes.some((route) => route.path === '/api/v1/auth/login')).toBe(false);
  });
});
