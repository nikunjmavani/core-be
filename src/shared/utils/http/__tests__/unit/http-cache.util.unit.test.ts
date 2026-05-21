import { describe, expect, it } from 'vitest';
import {
  catalogPayloadForEtag,
  CATALOG_CACHE_CONTROL,
  computeCatalogWeakEtag,
  computeWeakEtag,
  ifNoneMatchSatisfies,
} from '@/shared/utils/http/http-cache.util.js';

describe('http-cache.util', () => {
  it('computeWeakEtag is stable for the same payload', () => {
    const payload = { data: [{ id: 'plan_1' }], meta: { total: 1 } };
    expect(computeWeakEtag(payload)).toBe(computeWeakEtag(payload));
    expect(computeWeakEtag(payload)).toMatch(/^W\/"/);
  });

  it('computeWeakEtag changes when payload changes', () => {
    expect(computeWeakEtag({ a: 1 })).not.toBe(computeWeakEtag({ a: 2 }));
  });

  it('computeCatalogWeakEtag ignores per-request meta.request_id', () => {
    const catalog = [{ public_id: 'plan_1', name: 'Pro' }];
    const firstEnvelope = {
      data: catalog,
      meta: { request_id: 'req-a', pagination: { per_page: 1, next: null, has_more: false } },
    };
    const secondEnvelope = {
      data: catalog,
      meta: { request_id: 'req-b', pagination: { per_page: 1, next: null, has_more: false } },
    };
    expect(computeCatalogWeakEtag(firstEnvelope)).toBe(computeCatalogWeakEtag(secondEnvelope));
  });

  it('catalogPayloadForEtag extracts data from envelope', () => {
    const catalog = [{ code: 'billing:read' }];
    expect(catalogPayloadForEtag({ data: catalog, meta: { request_id: 'x' } })).toEqual(catalog);
  });

  it('ifNoneMatchSatisfies matches exact etag and wildcard', () => {
    const etag = 'W/"abc"';
    expect(ifNoneMatchSatisfies(etag, etag)).toBe(true);
    expect(ifNoneMatchSatisfies('W/"other"', etag)).toBe(false);
    expect(ifNoneMatchSatisfies('*', etag)).toBe(true);
    expect(ifNoneMatchSatisfies('W/"other", W/"abc"', etag)).toBe(true);
    expect(ifNoneMatchSatisfies(undefined, etag)).toBe(false);
  });

  it('exports catalog cache-control directive', () => {
    expect(CATALOG_CACHE_CONTROL).toContain('max-age=300');
    expect(CATALOG_CACHE_CONTROL).toContain('stale-while-revalidate=60');
  });
});
