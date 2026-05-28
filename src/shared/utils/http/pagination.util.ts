import { and, eq, gt, lt, ne, or, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import { ValidationError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/** i18n key for the friendly error when a legacy `page` query parameter is sent. */
export const LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY = 'errors:validation.legacyPageNotSupported';
/** English fallback for {@link LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY}, used when no i18n context is available. */
export const LEGACY_PAGE_NOT_SUPPORTED_MESSAGE =
  'Legacy `page` pagination is no longer supported on this route. Use cursor-based pagination via `limit` and `after` (opaque cursor from `meta.pagination.next`).';

/**
 * Throws a clear ValidationError when the request query contains the legacy
 * `page` parameter. List endpoints accept cursor pagination only (`limit` +
 * `after`); the older offset-based `page` is no longer supported.
 */
export function ensureCursorOnlyPagination(query: unknown): void {
  if (
    query !== null &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    Object.hasOwn(query, 'page')
  ) {
    throw new ValidationError(
      LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY,
      undefined,
      LEGACY_PAGE_NOT_SUPPORTED_MESSAGE,
      [
        {
          field: 'page',
          messageKey: LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY,
          message: LEGACY_PAGE_NOT_SUPPORTED_MESSAGE,
        },
      ],
    );
  }
}

/** Fastify preHandler wrapper for {@link ensureCursorOnlyPagination}; throws on legacy `page`. */
export async function rejectLegacyPagePagination(
  request: Pick<FastifyRequest, 'query'>,
): Promise<void> {
  ensureCursorOnlyPagination(request.query);
}

/**
 * Cursor-based pagination query schema.
 * Use `after` as the opaque cursor from the previous page's `meta.pagination.next`.
 */
export const cursorPaginationSchema = z.object({
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

/** Inferred shape of {@link cursorPaginationSchema} (after coercion / defaults). */
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;

/** Limit-only list queries (no cursor); same default and max as cursor lists. */
export const listLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

/** Inferred shape of {@link listLimitQuerySchema}. */
export type ListLimitQueryInput = z.infer<typeof listLimitQuerySchema>;

/** Validates an unknown query object as {@link ListLimitQueryInput}; throws on invalid input. */
export function parseListLimitQuery(query: unknown): ListLimitQueryInput {
  return listLimitQuerySchema.parse(query);
}

/**
 * Schema for the JSON payload encoded inside an opaque list cursor. Strict —
 * unknown keys fail decoding so callers cannot tunnel data through the cursor.
 */
export const listCursorPayloadSchema = z
  .object({
    created_at: z.string().datetime(),
    sort_value: z.string().optional(),
    public_id: z.string().min(1).max(21).optional(),
    id: z.number().int().positive().optional(),
  })
  .strict();

/** Inferred type of {@link listCursorPayloadSchema}; the fields encoded inside an opaque cursor. */
export type ListCursorPayload = z.infer<typeof listCursorPayloadSchema>;

/**
 * Result of {@link parseListCursor}: either a validated opaque cursor payload
 * (with `Date`-typed `created_at`) or a legacy numeric id used by older
 * callers that still pass `?after=<id>`.
 */
export type ParsedListCursor =
  | { kind: 'opaque'; created_at: Date; sort_value?: string; public_id?: string; id?: number }
  | { kind: 'legacy'; id: number };

/** Encodes a cursor payload as a URL-safe base64 string. */
export function encodeListCursor(payload: ListCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Decodes and validates an opaque cursor; returns `null` when the string is malformed or fails validation. */
export function decodeListCursor(cursor: string): ListCursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = listCursorPayloadSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Parses the `after` query parameter into a {@link ParsedListCursor}: tries
 * the opaque base64 form first, then falls back to the legacy numeric id.
 * Returns `null` when the cursor is missing or cannot be parsed.
 */
export function parseListCursor(after: string | undefined): ParsedListCursor | null {
  if (after === undefined || after.length === 0) {
    return null;
  }
  const opaque = decodeListCursor(after);
  if (opaque) {
    return omitUndefined({
      kind: 'opaque' as const,
      created_at: new Date(opaque.created_at),
      sort_value: opaque.sort_value,
      public_id: opaque.public_id,
      id: opaque.id,
    });
  }
  const legacyId = Number.parseInt(after, 10);
  if (Number.isFinite(legacyId) && legacyId > 0) {
    return { kind: 'legacy', id: legacyId };
  }
  return null;
}

/** Builds an opaque cursor string from a row's pagination columns; serializes `created_at` as ISO 8601. */
export function createOpaqueCursorFromRow(row: {
  created_at: Date;
  sort_value?: string;
  public_id?: string;
  id: number;
}): string {
  return encodeListCursor(
    omitUndefined({
      created_at: row.created_at.toISOString(),
      sort_value: row.sort_value,
      public_id: row.public_id,
      id: row.id,
    }),
  );
}

/** Returns the numeric id encoded in `cursor` for ascending-id pagination, or `undefined` for the first page. */
export function resolveAscendingIdAfter(cursor: ParsedListCursor | null): number | undefined {
  if (cursor === null) {
    return undefined;
  }
  if (cursor.kind === 'legacy') {
    return cursor.id;
  }
  return cursor.id;
}

/** Builds a Drizzle `WHERE` clause for ascending-by-id pagination; returns `undefined` for the first page. */
export function buildAscendingIdCursorCondition(
  idColumn: AnyColumn,
  cursor: ParsedListCursor | null,
): SQL | undefined {
  const afterId = resolveAscendingIdAfter(cursor);
  if (afterId === undefined) {
    return undefined;
  }
  return gt(idColumn, afterId);
}

/**
 * Builds a Drizzle `WHERE` clause for ascending pagination on
 * `(created_at, id)`. Excludes the boundary row by id so PostgreSQL's
 * microsecond precision (vs JavaScript's millisecond) cannot repeat the
 * cursor row across pages.
 */
export function buildAscendingCreatedAtIdCursorCondition(
  createdAtColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: ParsedListCursor | null,
): SQL | undefined {
  if (cursor === null) {
    return undefined;
  }
  if (cursor.kind === 'legacy') {
    return gt(idColumn, cursor.id);
  }
  const cursorId = cursor.id;
  if (cursorId === undefined) {
    return gt(createdAtColumn, cursor.created_at);
  }
  // PostgreSQL stores microseconds, while JavaScript Date serializes milliseconds.
  // Exclude the boundary row by id so precision loss cannot repeat it.
  return or(
    and(gt(createdAtColumn, cursor.created_at), ne(idColumn, cursorId)),
    and(eq(createdAtColumn, cursor.created_at), gt(idColumn, cursorId)),
  )!;
}

/**
 * Builds a Drizzle `WHERE` clause for ascending pagination on
 * `(text_column, id)`, e.g. sort by name then id. Requires `sort_value` and
 * `id` to be present in the cursor; legacy numeric cursors fall back to id.
 */
export function buildAscendingTextIdCursorCondition(
  textColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: ParsedListCursor | null,
): SQL | undefined {
  if (cursor === null) {
    return undefined;
  }
  if (cursor.kind === 'legacy') {
    return gt(idColumn, cursor.id);
  }
  const sortValue = cursor.sort_value;
  if (sortValue === undefined || cursor.id === undefined) {
    return undefined;
  }
  return or(gt(textColumn, sortValue), and(eq(textColumn, sortValue), gt(idColumn, cursor.id)))!;
}

/**
 * Builds a Drizzle `WHERE` clause for descending pagination on
 * `(created_at, id)`. Mirrors {@link buildAscendingCreatedAtIdCursorCondition}
 * but uses `<` so newer rows come first.
 */
export function buildDescendingCreatedAtIdCursorCondition(
  createdAtColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: ParsedListCursor | null,
): SQL | undefined {
  if (cursor === null) {
    return undefined;
  }
  if (cursor.kind === 'legacy') {
    return lt(idColumn, cursor.id);
  }
  const cursorId = cursor.id;
  if (cursorId === undefined) {
    return lt(createdAtColumn, cursor.created_at);
  }
  // PostgreSQL stores microseconds, while JavaScript Date serializes milliseconds.
  // Exclude the boundary row by id so precision loss cannot repeat it.
  return or(
    and(lt(createdAtColumn, cursor.created_at), ne(idColumn, cursorId)),
    and(eq(createdAtColumn, cursor.created_at), lt(idColumn, cursorId)),
  )!;
}
