import { describe, it, expect } from 'vitest';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  AUTHORIZATION_MODELS,
  loadRouteAuthorizationModel,
  requiresAuthorizationModel,
  routeModelKey,
} from '@/tests/helpers/route-authorization-model.js';

/**
 * Coverage gate for the declarative authorization model.
 *
 * Enforces, by construction, that every object-addressing protected route in
 * docs/routes.txt declares how it is authorized in route-authorization-model.json,
 * that there are no stale (orphan) entries, and that every model value is known.
 * A new by-id route added without a model entry fails CI — closing the
 * "authorization test silently never written" gap.
 */
describe('Global: authorization-model coverage', () => {
  const routes = loadRouteRegistryFromCatalog();
  const model = loadRouteAuthorizationModel();
  const required = routes.filter(requiresAuthorizationModel);

  it('covers a meaningful number of protected by-id routes', () => {
    expect(required.length).toBeGreaterThan(30);
  });

  it('every protected by-id route has an authorization-model entry', () => {
    const missing = required.map(routeModelKey).filter((key) => !(key in model));
    expect(missing, `Missing authorization-model entries:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every model entry maps to a real catalog route (no orphans)', () => {
    const catalogKeys = new Set(routes.map(routeModelKey));
    const orphans = Object.keys(model).filter((key) => !catalogKeys.has(key));
    expect(orphans, `Orphan authorization-model entries:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('every model entry uses a known model value', () => {
    const invalid = Object.entries(model)
      .filter(([, entry]) => !AUTHORIZATION_MODELS.includes(entry.model))
      .map(([key, entry]) => `${key} → ${entry.model}`);
    expect(invalid, `Unknown authorization model values:\n${invalid.join('\n')}`).toEqual([]);
  });
});
