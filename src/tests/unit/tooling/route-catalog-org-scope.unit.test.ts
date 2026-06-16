import { describe, expect, it } from 'vitest';
import {
  collectAllParsedRoutes,
  TEAM_ONLY_ROUTE_KEYS,
} from '@/scripts/codegen/generate-route-catalog.js';

/**
 * Guards the active-organization scope annotation (the catalog `org` column and
 * the personal-org 422 capability matrix). The TEAM-only key set is hand-curated
 * to mirror the service-layer guards; this test fails if a route is renamed out
 * from under a key (stale key) or if the generated catalog stops marking one of
 * them `team` — either of which would silently desync the catalog from the code.
 */
describe('route catalog — active-organization scope', () => {
  const routes = collectAllParsedRoutes();
  const keyOf = (route: { method: string; fullPath: string }) =>
    `${route.method} ${route.fullPath}`;
  const catalogKeys = new Set(routes.map(keyOf));

  it('every TEAM-only key still exists in the generated catalog (no stale keys)', () => {
    const stale = [...TEAM_ONLY_ROUTE_KEYS].filter((key) => !catalogKeys.has(key));
    expect(stale).toEqual([]);
  });

  it('marks exactly the TEAM-only routes with orgScope="team"', () => {
    const teamFromCatalog = new Set(routes.filter((route) => route.orgScope === 'team').map(keyOf));
    expect([...teamFromCatalog].sort()).toEqual([...TEAM_ONLY_ROUTE_KEYS].sort());
  });

  it('defaults every other route to orgScope="both"', () => {
    const nonTeam = routes.filter((route) => !TEAM_ONLY_ROUTE_KEYS.has(keyOf(route)));
    expect(nonTeam.every((route) => route.orgScope === 'both')).toBe(true);
  });
});
