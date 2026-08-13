import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  buildAscendingCreatedAtIdCursorCondition,
  buildAscendingIdCursorCondition,
  buildAscendingTextIdCursorCondition,
  buildDescendingCreatedAtIdCursorCondition,
  buildDescendingTextIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
  resolveAscendingIdAfter,
  type ParsedListCursor,
} from '@/shared/utils/http/pagination.util.js';

/**
 * Cursor `WHERE`-clause builders — the SQL half of keyset pagination.
 *
 * @remarks
 * These produce the predicate that decides which rows the next page contains. The failure modes
 * are quiet by nature: an off-by-one comparison repeats the boundary row on every page, and a
 * missing tie-breaker skips rows outright. Neither throws, and both look like a working list
 * endpoint until someone reconciles a total.
 *
 * The subtle one is documented in the source: PostgreSQL stores `timestamptz` to microseconds
 * while a JavaScript `Date` serialises milliseconds, so a cursor's `created_at` can round to a
 * value that compares equal to the row it came from. The builders exclude the boundary row by id
 * to compensate. That guard is invisible in a normal test run — you only see it under rows
 * written inside the same millisecond — so it is asserted here directly.
 *
 * SQL is rendered through `PgDialect`, which needs no database connection.
 */
const dialect = new PgDialect();

const table = pgTable('cursor_probe', {
  id: integer('id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  name: text('name').notNull(),
});

/** Renders a condition to `{ sql, params }` so structure and bound values can both be asserted. */
function render(condition: SQL | undefined): { sql: string; params: unknown[] } {
  if (condition === undefined) throw new Error('expected a condition, got undefined');
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
}

const CREATED_AT = new Date('2026-04-01T12:00:00.000Z');
/** Drizzle binds `timestamptz` as an ISO string, so that is what appears in `params`. */
const CREATED_AT_PARAM = CREATED_AT.toISOString();

/**
 * Blanks out the `<>` operator before a direction assertion.
 *
 * @remarks
 * `<>` contains both `<` and `>`, so a naive `not.toContain('<')` on a descending predicate — or
 * `'>'` on an ascending one — matches the tie-breaker rather than a direction operator.
 */
function withoutNotEqual(sql: string): string {
  return sql.replaceAll('<>', '#');
}

function cursorWith(overrides: Partial<ParsedListCursor> = {}): ParsedListCursor {
  return { kind: 'opaque', created_at: CREATED_AT, ...overrides };
}

describe('resolveAscendingIdAfter', () => {
  it('returns undefined for the first page', () => {
    expect(resolveAscendingIdAfter(null)).toBeUndefined();
  });

  it('returns the encoded id', () => {
    expect(resolveAscendingIdAfter(cursorWith({ id: 17 }))).toBe(17);
  });

  it('returns undefined when the cursor carries no id', () => {
    expect(resolveAscendingIdAfter(cursorWith())).toBeUndefined();
  });
});

describe('buildAscendingIdCursorCondition', () => {
  it('returns undefined for the first page, so no WHERE clause is added', () => {
    expect(buildAscendingIdCursorCondition(table.id, null)).toBeUndefined();
  });

  it('returns undefined when the cursor has no id', () => {
    expect(buildAscendingIdCursorCondition(table.id, cursorWith())).toBeUndefined();
  });

  it('emits a strict greater-than so the boundary row is not repeated', () => {
    const { sql, params } = render(
      buildAscendingIdCursorCondition(table.id, cursorWith({ id: 5 })),
    );

    expect(sql).toContain('>');
    expect(sql).not.toContain('>=');
    expect(params).toEqual([5]);
  });
});

describe('buildAscendingCreatedAtIdCursorCondition', () => {
  it('returns undefined for the first page', () => {
    expect(
      buildAscendingCreatedAtIdCursorCondition(table.created_at, table.id, null),
    ).toBeUndefined();
  });

  it('falls back to a bare timestamp comparison when the cursor has no id', () => {
    const { sql, params } = render(
      buildAscendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith()),
    );

    expect(sql).toContain('>');
    expect(params).toEqual([CREATED_AT_PARAM]);
  });

  it('excludes the boundary row by id when an id is present (microsecond guard)', () => {
    // Postgres keeps microseconds; the cursor carries milliseconds. Without the `!=` on the id,
    // a row whose truncated timestamp compares greater would come back on the next page too.
    const { sql, params } = render(
      buildAscendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith({ id: 9 })),
    );

    expect(sql).toMatch(/<>|!=/);
    expect(sql).toContain('or');
    expect(params).toEqual([CREATED_AT_PARAM, 9, CREATED_AT_PARAM, 9]);
  });

  it('advances forward — no `<` anywhere in an ascending predicate', () => {
    const { sql } = render(
      buildAscendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith({ id: 9 })),
    );

    expect(withoutNotEqual(sql)).not.toContain('<');
  });

  it('ties on an equal timestamp are broken by id', () => {
    // The `created_at = X and id > Y` branch: without it, rows sharing a timestamp are skipped.
    const { sql } = render(
      buildAscendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith({ id: 9 })),
    );

    expect(sql).toContain('=');
    expect(sql).toContain('and');
  });
});

describe('buildDescendingCreatedAtIdCursorCondition', () => {
  it('returns undefined for the first page', () => {
    expect(
      buildDescendingCreatedAtIdCursorCondition(table.created_at, table.id, null),
    ).toBeUndefined();
  });

  it('falls back to a bare timestamp comparison when the cursor has no id', () => {
    const { sql, params } = render(
      buildDescendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith()),
    );

    expect(sql).toContain('<');
    expect(params).toEqual([CREATED_AT_PARAM]);
  });

  it('mirrors the ascending builder with `<` so newer rows come first', () => {
    const { sql, params } = render(
      buildDescendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith({ id: 9 })),
    );

    expect(sql).toContain('<');
    expect(withoutNotEqual(sql)).not.toContain('>');
    expect(params).toEqual([CREATED_AT_PARAM, 9, CREATED_AT_PARAM, 9]);
  });

  it('carries the same microsecond guard as the ascending builder', () => {
    const { sql } = render(
      buildDescendingCreatedAtIdCursorCondition(table.created_at, table.id, cursorWith({ id: 9 })),
    );

    expect(sql).toMatch(/<>|!=/);
  });
});

describe('buildAscendingTextIdCursorCondition', () => {
  it('returns undefined for the first page', () => {
    expect(buildAscendingTextIdCursorCondition(table.name, table.id, null)).toBeUndefined();
  });

  it.each([
    ['no sort_value', { id: 3 }],
    ['no id', { sort_value: 'alpha' }],
    ['neither', {}],
  ])('returns undefined when the cursor has %s', (_label, overrides) => {
    // Falling back to an unfiltered query would silently restart the list from the top rather
    // than continuing it — worse than an error, because the caller cannot tell.
    expect(
      buildAscendingTextIdCursorCondition(table.name, table.id, cursorWith(overrides)),
    ).toBeUndefined();
  });

  it('compares the text column first and breaks ties on id', () => {
    const { sql, params } = render(
      buildAscendingTextIdCursorCondition(
        table.name,
        table.id,
        cursorWith({ sort_value: 'alpha', id: 4 }),
      ),
    );

    expect(sql).toContain('or');
    expect(sql).toContain('and');
    expect(params).toEqual(['alpha', 'alpha', 4]);
  });

  it('handles a sort value containing SQL metacharacters as a bound parameter', () => {
    // Sort values come from user-controlled columns (names, emails). They must be bound, never
    // interpolated — the rendered SQL should carry a placeholder, not the value.
    const hostile = "alpha'; DROP TABLE users; --";
    const { sql, params } = render(
      buildAscendingTextIdCursorCondition(
        table.name,
        table.id,
        cursorWith({ sort_value: hostile, id: 1 }),
      ),
    );

    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain(hostile);
  });
});

describe('buildDescendingTextIdCursorCondition', () => {
  it('returns undefined for the first page', () => {
    expect(buildDescendingTextIdCursorCondition(table.name, table.id, null)).toBeUndefined();
  });

  it('mirrors the ascending text builder with `<`', () => {
    const { sql, params } = render(
      buildDescendingTextIdCursorCondition(
        table.name,
        table.id,
        cursorWith({ sort_value: 'zeta', id: 8 }),
      ),
    );

    expect(sql).toContain('<');
    expect(params).toEqual(['zeta', 'zeta', 8]);
  });

  it('returns undefined when the cursor lacks sort_value or id', () => {
    expect(
      buildDescendingTextIdCursorCondition(table.name, table.id, cursorWith({ id: 2 })),
    ).toBeUndefined();
  });
});

describe('round trip: a row becomes a cursor becomes a predicate', () => {
  it('carries the row identity end to end', () => {
    // The property that actually matters in production: the values a repository encodes are the
    // values that come back out as bound parameters on the next page.
    const cursor = parseListCursor(createOpaqueCursorFromRow({ created_at: CREATED_AT, id: 12 }));

    const { params } = render(
      buildDescendingCreatedAtIdCursorCondition(table.created_at, table.id, cursor),
    );

    expect(params).toEqual([CREATED_AT_PARAM, 12, CREATED_AT_PARAM, 12]);
  });

  it('a text-sorted row round-trips its sort value', () => {
    const cursor = parseListCursor(
      createOpaqueCursorFromRow({ created_at: CREATED_AT, id: 3, sort_value: 'Acme Corp' }),
    );

    const { params } = render(buildAscendingTextIdCursorCondition(table.name, table.id, cursor));

    expect(params).toEqual(['Acme Corp', 'Acme Corp', 3]);
  });
});
