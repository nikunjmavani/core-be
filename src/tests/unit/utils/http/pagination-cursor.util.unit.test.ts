import { describe, expect, it } from 'vitest';
import {
  createOpaqueCursorFromRow,
  decodeListCursor,
  encodeListCursor,
  ensureCursorOnlyPagination,
  listCursorPayloadSchema,
  listLimitQuerySchema,
  parseListCursor,
  parseListLimitQuery,
} from '@/shared/utils/http/pagination.util.js';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import { ValidationError } from '@/shared/errors/index.js';

/**
 * Opaque list cursors — the encode/decode core every list endpoint paginates through.
 *
 * @remarks
 * A cursor is attacker-supplied input: it arrives as the `after` query parameter and is decoded
 * straight into values that shape a SQL query. The implementation carries three deliberate
 * defences, none of which had a test naming it:
 *
 * 1. `listCursorPayloadSchema` is `.strict()`, so unknown keys fail decoding rather than being
 *    silently dropped — callers cannot tunnel extra data through a cursor.
 * 2. `filter_fingerprint` (sec-U12) binds a cursor to the filter set that minted it, so a cursor
 *    obtained under one filter cannot be replayed against another.
 * 3. Legacy bare-integer `after` values are refused, because accepting them leaked internal
 *    auto-increment ids to API consumers.
 *
 * Decoding failures must yield `null` — "start from the first page" — never a throw, because a
 * malformed cursor is a client mistake, not a server error.
 */
const CREATED_AT = new Date('2026-04-01T12:00:00.000Z');
const VALID_FINGERPRINT = 'a'.repeat(64);

describe('encodeListCursor / decodeListCursor', () => {
  it('round-trips a full payload', () => {
    const payload = {
      created_at: CREATED_AT.toISOString(),
      public_id: 'usr_abcdefghijklmnopqrstu',
      id: 42,
      sort_value: 'alpha',
      filter_fingerprint: VALID_FINGERPRINT,
    };

    expect(decodeListCursor(encodeListCursor(payload))).toEqual(payload);
  });

  it('produces a URL-safe token with no base64 padding or reserved characters', () => {
    // The cursor travels in a query string; `+`, `/` and `=` would need escaping and routinely
    // survive a round trip mangled.
    const cursor = encodeListCursor({ created_at: CREATED_AT.toISOString(), id: 1 });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for a cursor carrying unknown keys (strict schema)', () => {
    // The whole point of `.strict()`: a caller must not be able to smuggle fields through the
    // cursor and have them reach the query builder.
    const smuggled = Buffer.from(
      JSON.stringify({ created_at: CREATED_AT.toISOString(), id: 1, organization_id: 99 }),
    ).toString('base64url');

    expect(decodeListCursor(smuggled)).toBeNull();
  });

  it.each([
    ['not base64 at all', 'definitely-not-a-cursor!!'],
    ['valid base64 that is not JSON', Buffer.from('hello').toString('base64url')],
    ['JSON that is not an object', Buffer.from('"a string"').toString('base64url')],
    ['JSON array', Buffer.from('[1,2,3]').toString('base64url')],
    ['empty string', ''],
    ['JSON null', Buffer.from('null').toString('base64url')],
  ])('returns null for %s rather than throwing', (_label, cursor) => {
    expect(() => decodeListCursor(cursor)).not.toThrow();
    expect(decodeListCursor(cursor)).toBeNull();
  });

  it('rejects a payload missing the required created_at', () => {
    const cursor = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url');

    expect(decodeListCursor(cursor)).toBeNull();
  });

  it('rejects a created_at that is not an ISO datetime', () => {
    const cursor = Buffer.from(JSON.stringify({ created_at: 'yesterday', id: 1 })).toString(
      'base64url',
    );

    expect(decodeListCursor(cursor)).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('rejects a %s id', (_label, id) => {
    const cursor = Buffer.from(
      JSON.stringify({ created_at: CREATED_AT.toISOString(), id }),
    ).toString('base64url');

    expect(decodeListCursor(cursor)).toBeNull();
  });

  it('rejects a public_id longer than the 28-character ceiling', () => {
    const cursor = Buffer.from(
      JSON.stringify({ created_at: CREATED_AT.toISOString(), public_id: 'x'.repeat(29) }),
    ).toString('base64url');

    expect(decodeListCursor(cursor)).toBeNull();
  });

  it('rejects a filter_fingerprint that is not 64 hex characters', () => {
    // sec-U12: a fingerprint the repository cannot compare is worse than none — it would look
    // like a bound cursor while binding nothing.
    for (const fingerprint of ['abc', 'z'.repeat(64), 'A'.repeat(64), `${VALID_FINGERPRINT}0`]) {
      const cursor = Buffer.from(
        JSON.stringify({ created_at: CREATED_AT.toISOString(), filter_fingerprint: fingerprint }),
      ).toString('base64url');

      expect(decodeListCursor(cursor)).toBeNull();
    }
  });

  it('accepts a well-formed lowercase hex fingerprint', () => {
    const cursor = encodeListCursor({
      created_at: CREATED_AT.toISOString(),
      filter_fingerprint: VALID_FINGERPRINT,
    });

    expect(decodeListCursor(cursor)?.filter_fingerprint).toBe(VALID_FINGERPRINT);
  });
});

describe('parseListCursor', () => {
  it('returns null for an absent cursor (first page)', () => {
    expect(parseListCursor(undefined)).toBeNull();
    expect(parseListCursor('')).toBeNull();
  });

  it('rejects a legacy bare-integer cursor', () => {
    // Accepting these leaked internal auto-increment ids to API consumers, and let a caller
    // page from an arbitrary row by guessing.
    for (const legacy of ['1', '42', '999999']) {
      expect(parseListCursor(legacy)).toBeNull();
    }
  });

  it('materialises created_at as a Date', () => {
    const cursor = encodeListCursor({ created_at: CREATED_AT.toISOString(), id: 7 });

    const parsed = parseListCursor(cursor);

    expect(parsed?.kind).toBe('opaque');
    expect(parsed?.created_at).toBeInstanceOf(Date);
    expect(parsed?.created_at.toISOString()).toBe(CREATED_AT.toISOString());
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    // The result is spread into query builders; an explicit `undefined` key reads as "filter on
    // undefined" in some call sites.
    const parsed = parseListCursor(encodeListCursor({ created_at: CREATED_AT.toISOString() }));

    expect(parsed).not.toBeNull();
    expect(Object.hasOwn(parsed ?? {}, 'id')).toBe(false);
    expect(Object.hasOwn(parsed ?? {}, 'public_id')).toBe(false);
    expect(Object.hasOwn(parsed ?? {}, 'filter_fingerprint')).toBe(false);
  });

  it('carries the filter fingerprint through for the repository to compare', () => {
    const cursor = encodeListCursor({
      created_at: CREATED_AT.toISOString(),
      filter_fingerprint: VALID_FINGERPRINT,
    });

    expect(parseListCursor(cursor)?.filter_fingerprint).toBe(VALID_FINGERPRINT);
  });

  it('returns null for a tampered cursor', () => {
    const cursor = encodeListCursor({ created_at: CREATED_AT.toISOString(), id: 5 });
    const tampered = `${cursor.slice(0, -3)}AAA`;

    // Either it decodes to something schema-valid or it does not; what it must never do is throw.
    expect(() => parseListCursor(tampered)).not.toThrow();
  });
});

describe('createOpaqueCursorFromRow', () => {
  it('serialises created_at as ISO 8601 and round-trips through the parser', () => {
    const cursor = createOpaqueCursorFromRow({ created_at: CREATED_AT, id: 11 });

    const parsed = parseListCursor(cursor);

    expect(parsed?.created_at.toISOString()).toBe(CREATED_AT.toISOString());
    expect(parsed?.id).toBe(11);
  });

  it('omits optional columns the row did not carry', () => {
    const decoded = decodeListCursor(createOpaqueCursorFromRow({ created_at: CREATED_AT, id: 3 }));

    expect(decoded).not.toBeNull();
    expect(Object.hasOwn(decoded ?? {}, 'sort_value')).toBe(false);
    expect(Object.hasOwn(decoded ?? {}, 'public_id')).toBe(false);
  });

  it('preserves sort_value, public_id and fingerprint when present', () => {
    const decoded = decodeListCursor(
      createOpaqueCursorFromRow({
        created_at: CREATED_AT,
        id: 4,
        sort_value: 'zeta',
        public_id: 'org_abcdefghijklmnopqrstu',
        filter_fingerprint: VALID_FINGERPRINT,
      }),
    );

    expect(decoded).toMatchObject({
      sort_value: 'zeta',
      public_id: 'org_abcdefghijklmnopqrstu',
      filter_fingerprint: VALID_FINGERPRINT,
    });
  });
});

describe('ensureCursorOnlyPagination', () => {
  it('rejects a legacy `page` query with a ValidationError naming the field', () => {
    try {
      ensureCursorOnlyPagination({ page: 2 });
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).errors?.[0]?.field).toBe('page');
    }
  });

  it('rejects `page` even when it is empty or zero', () => {
    // Presence is what matters — an offset-paginating client is broken regardless of the value.
    for (const query of [{ page: 0 }, { page: '' }, { page: null }]) {
      expect(() => ensureCursorOnlyPagination(query)).toThrow(ValidationError);
    }
  });

  it.each([
    ['cursor query', { limit: 10, after: 'abc' }],
    ['empty object', {}],
    ['null', null],
    ['array', [1, 2]],
    ['string', 'page'],
  ])('accepts %s', (_label, query) => {
    expect(() => ensureCursorOnlyPagination(query)).not.toThrow();
  });
});

describe('listLimitQuerySchema / parseListLimitQuery', () => {
  it('applies the default limit when none is supplied', () => {
    expect(parseListLimitQuery({}).limit).toBe(PAGINATION.DEFAULT_LIMIT);
  });

  it('coerces a numeric string, as query parameters always arrive as strings', () => {
    expect(parseListLimitQuery({ limit: '25' }).limit).toBe(25);
  });

  it('accepts the boundary values', () => {
    expect(parseListLimitQuery({ limit: 1 }).limit).toBe(1);
    expect(parseListLimitQuery({ limit: PAGINATION.MAX_LIMIT }).limit).toBe(PAGINATION.MAX_LIMIT);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 2.5],
    ['above the maximum', PAGINATION.MAX_LIMIT + 1],
    ['not a number', 'plenty'],
  ])('rejects a %s limit', (_label, limit) => {
    expect(listLimitQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});

describe('listCursorPayloadSchema', () => {
  it('requires created_at and nothing else', () => {
    expect(
      listCursorPayloadSchema.safeParse({ created_at: CREATED_AT.toISOString() }).success,
    ).toBe(true);
    expect(listCursorPayloadSchema.safeParse({ id: 1 }).success).toBe(false);
  });
});
