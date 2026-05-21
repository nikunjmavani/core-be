/** List pagination defaults, caps, and offset deprecation schedule. */

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
} as const;

/**
 * Offset `page` query pagination is removed after this instant (RFC 8594 `Sunset`).
 * During the deprecation window, `page` still works and responses include deprecation headers.
 */
export const OFFSET_PAGINATION_SUNSET = new Date('2026-08-19T00:00:00.000Z');
