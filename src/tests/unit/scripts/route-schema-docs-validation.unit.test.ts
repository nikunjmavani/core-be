import { describe, expect, it } from 'vitest';
import type { RouteSchemaEntry } from '@tooling/openapi/extractors/route-schema-metadata.js';
import { findRouteSchemaDocProblems } from '@/scripts/validators/routes/route-schema-docs-validation.util.js';

const sampleEntry = (
  overrides: Partial<Omit<RouteSchemaEntry, 'metadata'>> & {
    metadata?: Partial<RouteSchemaEntry['metadata']>;
  } = {},
): RouteSchemaEntry => {
  const { metadata, ...rest } = overrides;
  return {
    method: 'POST',
    fullPath: '/api/v1/sample',
    lookupKey: 'POST /api/v1/sample',
    ...rest,
    metadata: {
      summary: 'Sample',
      description: 'A sample route',
      tags: ['Sample'],
      ...metadata,
    },
  };
};

describe('findRouteSchemaDocProblems', () => {
  it('returns no problems when every route has summary, description, and tags', () => {
    expect(findRouteSchemaDocProblems([sampleEntry()])).toEqual([]);
  });

  it('flags a route missing only its summary', () => {
    const problems = findRouteSchemaDocProblems([
      sampleEntry({ lookupKey: 'GET /api/v1/x', metadata: { summary: null } }),
    ]);
    expect(problems).toEqual(['GET /api/v1/x (missing: summary)']);
  });

  it('lists every missing field for a fully undocumented route and ignores complete routes', () => {
    const problems = findRouteSchemaDocProblems([
      sampleEntry({ lookupKey: 'GET /api/v1/ok' }),
      sampleEntry({
        lookupKey: 'POST /api/v1/bad',
        metadata: { summary: null, description: null, tags: null },
      }),
    ]);
    expect(problems).toEqual(['POST /api/v1/bad (missing: summary, description, tags)']);
  });

  it('treats null tags as missing tags', () => {
    expect(
      findRouteSchemaDocProblems([
        sampleEntry({ lookupKey: 'GET /api/v1/notags', metadata: { tags: null } }),
      ]),
    ).toEqual(['GET /api/v1/notags (missing: tags)']);
  });
});
