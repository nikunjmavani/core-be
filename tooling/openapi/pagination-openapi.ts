/**
 * Cursor pagination conventions for OpenAPI generation and completeness tests.
 *
 * @see docs/reference/api/api-versioning.md — Cursor list pagination
 */
import { PAGINATION } from '@/shared/constants/index.js';

/** Appended to list-operation descriptions in route metadata. */
export const CURSOR_PAGINATION_DESCRIPTION_SUFFIX = ` Uses cursor pagination: pass \`limit\` (default ${PAGINATION.DEFAULT_LIMIT}, max ${PAGINATION.MAX_LIMIT}) and optional \`after\` (opaque cursor from the previous response \`meta.pagination.next\`). Legacy \`page\` offset is deprecated until 2026-08-19 UTC and returns \`Deprecation\` / \`Sunset\` headers; after that date it returns 410 Gone.`;

/**
 * GET list routes that use cursor pagination (`cursorListQuerySchema` or extensions).
 * Keys: "METHOD /openapi/path" (with `{param}` placeholders).
 */
export const CURSOR_PAGINATED_LIST_ROUTE_KEYS = [
  'GET /api/v1/audit/logs',
  'GET /api/v1/users',
  'GET /api/v1/tenancy/organizations',
  'GET /api/v1/tenancy/organizations/{id}/audit-logs',
  'GET /api/v1/tenancy/organizations/{id}/api-keys',
  'GET /api/v1/tenancy/organizations/{id}/memberships',
  'GET /api/v1/tenancy/organizations/{id}/roles',
  'GET /api/v1/notify/notifications',
] as const;

export type CursorPaginatedListRouteKey = (typeof CURSOR_PAGINATED_LIST_ROUTE_KEYS)[number];
