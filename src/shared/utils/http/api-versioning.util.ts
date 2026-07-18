import type { FastifyReply } from 'fastify';

/** Major path segment for the current stable public HTTP API (e.g. `/api/v1/...`). */
export const PUBLIC_API_VERSION_SEGMENT_V1 = 'v1';

/** Response header exposing the major API version for `/api/v1` traffic (RFC 7231 field name). */
export const PUBLIC_API_VERSION_HEADER = 'API-Version';

/** Value for {@link PUBLIC_API_VERSION_HEADER} on current stable major version responses. */
export const PUBLIC_API_VERSION_VALUE_V1 = '1';

/**
 * Base path for a major API version, without a trailing slash.
 * Combine with a domain segment for Fastify `prefix` (e.g. `${buildPublicApiPrefix('v1')}/auth`).
 */
export function buildPublicApiPrefix(versionSegment: string): string {
  return `/api/${versionSegment}`;
}

/** Sets {@link PUBLIC_API_VERSION_HEADER} on stable major-version public API responses. */
export function applyPublicApiVersionHeader(
  reply: FastifyReply,
  versionValue: string = PUBLIC_API_VERSION_VALUE_V1,
): void {
  reply.header(PUBLIC_API_VERSION_HEADER, versionValue);
}
