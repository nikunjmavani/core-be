import { describe, expect, it } from 'vitest';
import {
  getRouteCount,
  loadRouteRegistryFromCatalog,
} from '@/tests/helpers/route-catalog-registry.js';
import { collectAllParsedRoutes } from '@/scripts/codegen/generate-route-catalog.js';

describe('route-catalog-registry', () => {
  it('loadRouteRegistryFromCatalog parses docs/routes.txt with expected shape', () => {
    const routes = loadRouteRegistryFromCatalog();
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((route) => route.domain === 'auth' && route.method === 'POST')).toBe(true);
    expect(routes.every((route) => route.path.startsWith('/'))).toBe(true);
    expect(routes.every((route) => route.description.includes(route.path))).toBe(true);
  });

  it('parsed catalog route count matches generator source route count', () => {
    const catalogCount = getRouteCount();
    const sourceCount = collectAllParsedRoutes().length;
    expect(catalogCount).toBe(sourceCount);
  });
});
