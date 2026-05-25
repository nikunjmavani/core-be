import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { z } from 'zod';
import { GoneError } from '@/shared/errors/index.js';
import { PAGINATION, OFFSET_PAGINATION_SUNSET } from '@/shared/constants/pagination.constants.js';
import {
  alertDeprecatedUsagePastSunset,
  applyDeprecatedEndpointHeaders,
} from '@/shared/utils/http/api-versioning.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * Cursor-based pagination query schema.
 * Use `after` as the opaque cursor from the previous page's `meta.pagination.next`.
 */
export const cursorPaginationSchema = z.object({
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;

/** Cursor list queries accept `after` and, during deprecation, legacy `page`. */
export const cursorListQuerySchema = cursorPaginationSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
});

export type CursorListQueryInput = z.infer<typeof cursorListQuerySchema>;

/** Limit-only list queries (no cursor); same default and max as cursor lists. */
export const listLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

export type ListLimitQueryInput = z.infer<typeof listLimitQuerySchema>;

export function parseListLimitQuery(query: unknown): ListLimitQueryInput {
  return listLimitQuerySchema.parse(query);
}

export const listCursorPayloadSchema = z
  .object({
    created_at: z.string().datetime(),
    sort_value: z.string().optional(),
    public_id: z.string().min(1).max(21).optional(),
    id: z.number().int().positive().optional(),
  })
  .strict();

export type ListCursorPayload = z.infer<typeof listCursorPayloadSchema>;

export type ParsedListCursor =
  | { kind: 'opaque'; created_at: Date; sort_value?: string; public_id?: string; id?: number }
  | { kind: 'legacy'; id: number };

export type ResolvedListPagination = {
  limit: number;
  after?: string;
  offsetPage?: number;
};

export function encodeListCursor(payload: ListCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeListCursor(cursor: string): ListCursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = listCursorPayloadSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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

export function isOffsetPaginationPastSunset(now: Date = new Date()): boolean {
  return now.getTime() >= OFFSET_PAGINATION_SUNSET.getTime();
}

/**
 * Parses cursor list query params and applies offset deprecation policy.
 * When `page` is present before sunset, sets RFC 8594/9745 headers on `reply`.
 */
export type ListPaginationRequestContext = {
  method: string;
  url: string;
};

export function resolveListPaginationQuery(
  query: unknown,
  reply?: FastifyReply,
  requestContext?: ListPaginationRequestContext,
): ResolvedListPagination {
  const parsed = cursorListQuerySchema.parse(query);
  if (parsed.page !== undefined) {
    if (isOffsetPaginationPastSunset()) {
      if (requestContext) {
        alertDeprecatedUsagePastSunset({
          surface: 'offset-pagination-page',
          sunset: OFFSET_PAGINATION_SUNSET,
          method: requestContext.method,
          url: requestContext.url,
          statusCode: 410,
        });
      }
      throw new GoneError();
    }
    if (reply) {
      applyDeprecatedEndpointHeaders(reply, {
        sunset: OFFSET_PAGINATION_SUNSET,
        deprecation: true,
      });
    }
    return omitUndefined({ limit: parsed.limit, offsetPage: parsed.page, after: parsed.after });
  }
  return omitUndefined({ limit: parsed.limit, after: parsed.after });
}

export function resolveListPaginationQueryForRequest(
  request: Pick<FastifyRequest, 'query' | 'method' | 'url'>,
  reply?: FastifyReply,
): ResolvedListPagination {
  return resolveListPaginationQuery(request.query, reply, {
    method: request.method,
    url: request.url,
  });
}

export function resolveAscendingIdAfter(cursor: ParsedListCursor | null): number | undefined {
  if (cursor === null) {
    return undefined;
  }
  if (cursor.kind === 'legacy') {
    return cursor.id;
  }
  return cursor.id;
}

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
  return or(
    gt(createdAtColumn, cursor.created_at),
    and(eq(createdAtColumn, cursor.created_at), gt(idColumn, cursorId)),
  )!;
}

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
  return or(
    lt(createdAtColumn, cursor.created_at),
    and(eq(createdAtColumn, cursor.created_at), lt(idColumn, cursorId)),
  )!;
}
