import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  applyCatalogCacheHeaders,
  CATALOG_CACHE_CONTROL,
  catalogPayloadForEtag,
  computeCatalogWeakEtag,
  ifNoneMatchSatisfies,
} from '@/shared/utils/http/http-cache.util.js';
import { getAuditRequestNetworkContext } from '@/shared/utils/infrastructure/audit-request-context.util.js';

/**
 * Catalog HTTP caching and the audit network-context extractor.
 *
 * @remarks
 * The caching path is conditional-request machinery: get the ETag wrong in one direction and every
 * client refetches an unchanged catalog; get it wrong in the other and a client keeps serving a
 * stale plan list after prices change. Both failures are invisible from the server's own logs,
 * which is exactly why the ETag inputs deserve pinning.
 */
function requestWith(headers: Record<string, string | string[] | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function replySpy() {
  const reply = {
    header: vi.fn(() => reply),
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return reply as unknown as FastifyReply & {
    header: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

const CATALOG_ENVELOPE = {
  data: [{ id: 'pln_abcdefghijklmnopqrstu', name: 'Pro' }],
  meta: { request_id: 'req_one', pagination: { has_more: false } },
};

describe('catalogPayloadForEtag', () => {
  it('ignores per-request meta so repeat fetches can hit 304', () => {
    // meta.request_id changes on every request. If it fed the ETag, no client would ever get a
    // 304 and the cache headers would be decorative.
    const first = catalogPayloadForEtag(CATALOG_ENVELOPE);
    const second = catalogPayloadForEtag({
      ...CATALOG_ENVELOPE,
      meta: { ...CATALOG_ENVELOPE.meta, request_id: 'req_two' },
    });

    expect(first).toEqual(second);
  });

  it('unwraps to the data payload, which is what the ETag represents', () => {
    // Returns `data` itself rather than a reduced envelope, so the hash is over catalog content
    // alone — nothing about the envelope can perturb it.
    expect(catalogPayloadForEtag(CATALOG_ENVELOPE)).toEqual(CATALOG_ENVELOPE.data);
  });

  it('passes a non-envelope payload through unchanged', () => {
    // Not every cached response uses the Paddle envelope; those must still hash to something.
    expect(catalogPayloadForEtag([1, 2, 3])).toEqual([1, 2, 3]);
    expect(catalogPayloadForEtag('plain')).toBe('plain');
    expect(catalogPayloadForEtag(null)).toBeNull();
  });
});

describe('computeCatalogWeakEtag', () => {
  it('is stable for the same catalog content', () => {
    expect(computeCatalogWeakEtag(CATALOG_ENVELOPE)).toBe(computeCatalogWeakEtag(CATALOG_ENVELOPE));
  });

  it('is unchanged when only the request id differs', () => {
    expect(
      computeCatalogWeakEtag({
        ...CATALOG_ENVELOPE,
        meta: { ...CATALOG_ENVELOPE.meta, request_id: 'req_different' },
      }),
    ).toBe(computeCatalogWeakEtag(CATALOG_ENVELOPE));
  });

  it('changes when the catalog data changes', () => {
    // The load-bearing direction: a price or plan change must invalidate the client's copy.
    expect(
      computeCatalogWeakEtag({
        ...CATALOG_ENVELOPE,
        data: [{ id: 'pln_abcdefghijklmnopqrstu', name: 'Pro Plus' }],
      }),
    ).not.toBe(computeCatalogWeakEtag(CATALOG_ENVELOPE));
  });

  it('changes when an entry is removed', () => {
    expect(computeCatalogWeakEtag({ ...CATALOG_ENVELOPE, data: [] })).not.toBe(
      computeCatalogWeakEtag(CATALOG_ENVELOPE),
    );
  });

  it('emits a weak validator', () => {
    // Weak (`W/`) is correct here: the bytes may differ (key order, whitespace) while the
    // representation is semantically identical.
    expect(computeCatalogWeakEtag(CATALOG_ENVELOPE)).toMatch(/^W\//);
  });
});

describe('ifNoneMatchSatisfies', () => {
  const etag = computeCatalogWeakEtag(CATALOG_ENVELOPE);

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])('returns false for %s', (_label, header) => {
    expect(ifNoneMatchSatisfies(header, etag)).toBe(false);
  });

  it('matches an exact echo of the ETag', () => {
    expect(ifNoneMatchSatisfies(etag, etag)).toBe(true);
  });

  it('matches when the ETag appears in a comma-separated list', () => {
    // Clients legitimately send several validators at once.
    expect(ifNoneMatchSatisfies(`W/"other", ${etag}`, etag)).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(ifNoneMatchSatisfies('*', etag)).toBe(true);
  });

  it('does not match a different ETag', () => {
    // The failure that would serve stale data: a mismatched validator must force a full response.
    expect(ifNoneMatchSatisfies('W/"something-else"', etag)).toBe(false);
  });

  it('accepts a header delivered as an array', () => {
    expect(ifNoneMatchSatisfies([etag], etag)).toBe(true);
  });
});

describe('applyCatalogCacheHeaders', () => {
  it('sets both cache headers and returns false when there is no matching validator', () => {
    const reply = replySpy();

    const handled = applyCatalogCacheHeaders(requestWith({}), reply, CATALOG_ENVELOPE);

    expect(handled).toBe(false);
    expect(reply.header).toHaveBeenCalledWith('ETag', expect.stringMatching(/^W\//));
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', CATALOG_CACHE_CONTROL);
    // Returning false means "carry on and send the body" — it must not have replied already.
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('short-circuits with 304 and an empty body when the validator matches', () => {
    const etag = computeCatalogWeakEtag(CATALOG_ENVELOPE);
    const reply = replySpy();

    const handled = applyCatalogCacheHeaders(
      requestWith({ 'if-none-match': etag }),
      reply,
      CATALOG_ENVELOPE,
    );

    expect(handled).toBe(true);
    expect(reply.status).toHaveBeenCalledWith(304);
    // A 304 must not carry a body; sending one is a protocol violation some clients choke on.
    expect(reply.send).toHaveBeenCalledWith();
  });

  it('still sets the ETag on the 304 response', () => {
    // Clients revalidate against the ETag they were last given; omitting it on a 304 breaks the
    // next conditional request.
    const etag = computeCatalogWeakEtag(CATALOG_ENVELOPE);
    const reply = replySpy();

    applyCatalogCacheHeaders(requestWith({ 'if-none-match': etag }), reply, CATALOG_ENVELOPE);

    expect(reply.header).toHaveBeenCalledWith('ETag', etag);
  });

  it('sends a full response when the client holds a stale validator', () => {
    const staleEtag = computeCatalogWeakEtag({ ...CATALOG_ENVELOPE, data: [] });
    const reply = replySpy();

    const handled = applyCatalogCacheHeaders(
      requestWith({ 'if-none-match': staleEtag }),
      reply,
      CATALOG_ENVELOPE,
    );

    expect(handled).toBe(false);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('ignores a differing request id when matching the validator', () => {
    // End-to-end version of the meta-stripping property: the same catalog fetched twice must
    // still 304, even though each response carries a fresh request id.
    const etagFromFirstResponse = computeCatalogWeakEtag(CATALOG_ENVELOPE);
    const reply = replySpy();

    const handled = applyCatalogCacheHeaders(
      requestWith({ 'if-none-match': etagFromFirstResponse }),
      reply,
      { ...CATALOG_ENVELOPE, meta: { ...CATALOG_ENVELOPE.meta, request_id: 'req_fresh' } },
    );

    expect(handled).toBe(true);
  });
});

describe('CATALOG_CACHE_CONTROL', () => {
  it('is publicly cacheable with a max-age and a stale-while-revalidate window', () => {
    expect(CATALOG_CACHE_CONTROL).toContain('public');
    expect(CATALOG_CACHE_CONTROL).toMatch(/max-age=\d+/);
    expect(CATALOG_CACHE_CONTROL).toMatch(/stale-while-revalidate=\d+/);
  });

  it('is not marked private or no-store, which would defeat the ETag path', () => {
    expect(CATALOG_CACHE_CONTROL).not.toContain('no-store');
    expect(CATALOG_CACHE_CONTROL).not.toContain('private');
  });
});

describe('getAuditRequestNetworkContext', () => {
  // These two fields are the forensic record on every audit row. A null where a value existed
  // makes an incident harder to trace; a non-string leaking through would break the insert.

  it('extracts the ip and user-agent', () => {
    const request = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'Mozilla/5.0' },
    } as unknown as FastifyRequest;

    expect(getAuditRequestNetworkContext(request)).toEqual({
      ip_address: '203.0.113.7',
      user_agent: 'Mozilla/5.0',
    });
  });

  it('returns null for a missing user-agent rather than undefined', () => {
    // The audit column is nullable; undefined would be dropped by JSON serialisation and could
    // land as a missing key instead of an explicit null.
    const request = { ip: '203.0.113.7', headers: {} } as unknown as FastifyRequest;

    expect(getAuditRequestNetworkContext(request).user_agent).toBeNull();
  });

  it('returns null when the user-agent arrives as an array', () => {
    // A duplicated header parses to an array; passing that to a text column would throw at
    // insert time, inside the audit path where it is hardest to see.
    const request = {
      ip: '203.0.113.7',
      headers: { 'user-agent': ['a', 'b'] },
    } as unknown as FastifyRequest;

    expect(getAuditRequestNetworkContext(request).user_agent).toBeNull();
  });

  it('returns null for a missing ip', () => {
    const request = { headers: {} } as unknown as FastifyRequest;

    expect(getAuditRequestNetworkContext(request).ip_address).toBeNull();
  });

  it('preserves an IPv6 address verbatim', () => {
    const request = {
      ip: '2001:db8::1',
      headers: {},
    } as unknown as FastifyRequest;

    expect(getAuditRequestNetworkContext(request).ip_address).toBe('2001:db8::1');
  });

  it('always returns both keys, so the audit row shape is stable', () => {
    const context = getAuditRequestNetworkContext({ headers: {} } as unknown as FastifyRequest);

    expect(Object.keys(context).sort()).toEqual(['ip_address', 'user_agent']);
  });
});
