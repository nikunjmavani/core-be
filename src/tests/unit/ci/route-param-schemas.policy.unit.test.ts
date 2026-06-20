import { describe, expect, it } from 'vitest';
import { findRoutesMissingParamSchema } from '@/scripts/validators/routes/validate-route-param-schemas.js';
import {
  collectAllRouteSchemaEntries,
  type RouteSchemaEntry,
} from '@tooling/openapi/extractors/route-schema-metadata.js';

function buildEntry(overrides: Partial<RouteSchemaEntry>): RouteSchemaEntry {
  return {
    method: 'GET',
    fullPath: '/api/v1/things',
    lookupKey: 'GET /api/v1/things',
    metadata: { summary: 's', description: 'd', tags: ['T'] },
    hasParamsSchema: false,
    ...overrides,
  };
}

describe('validate-route-param-schemas policy', () => {
  it('flags a :param route that omits schema.params', () => {
    const offenders = findRoutesMissingParamSchema([
      buildEntry({ method: 'GET', fullPath: '/api/v1/things/:thing_id', hasParamsSchema: false }),
    ]);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.fullPath).toBe('/api/v1/things/:thing_id');
  });

  it('passes a :param route that declares schema.params', () => {
    const offenders = findRoutesMissingParamSchema([
      buildEntry({ method: 'GET', fullPath: '/api/v1/things/:thing_id', hasParamsSchema: true }),
    ]);
    expect(offenders).toHaveLength(0);
  });

  it('ignores routes without a :param segment', () => {
    const offenders = findRoutesMissingParamSchema([
      buildEntry({ method: 'POST', fullPath: '/api/v1/things', hasParamsSchema: false }),
    ]);
    expect(offenders).toHaveLength(0);
  });

  it('the live route catalog has no :param route missing schema.params (EX-05 stays closed)', () => {
    expect(findRoutesMissingParamSchema(collectAllRouteSchemaEntries())).toEqual([]);
  });
});
