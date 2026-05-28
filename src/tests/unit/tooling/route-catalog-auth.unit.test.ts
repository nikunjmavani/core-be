import { describe, it, expect } from 'vitest';
import {
  loadProtectedRoutesFromCatalog,
  materializeRouteCatalogPath,
} from '@/tests/helpers/route-catalog-auth.js';

describe('route-catalog-auth', () => {
  it('materializeRouteCatalogPath replaces path parameters', () => {
    expect(materializeRouteCatalogPath('/api/v1/tenancy/organizations/:id/settings')).toBe(
      '/api/v1/tenancy/organizations/000000000000000000000/settings',
    );
  });

  it('loadProtectedRoutesFromCatalog includes AUTH and PERM routes', () => {
    const routes = loadProtectedRoutesFromCatalog();
    expect(
      routes.some((route) => route.path === '/api/v1/users/me' && route.access === 'AUTH'),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path.includes('/organizations/') &&
          route.path.includes('/settings') &&
          route.access === 'PERM',
      ),
    ).toBe(true);
  });

  it('loadProtectedRoutesFromCatalog excludes PUBLIC routes', () => {
    const routes = loadProtectedRoutesFromCatalog();
    expect(routes.some((route) => route.path === '/api/v1/auth/login')).toBe(false);
  });
});
