import {
  buildPublicApiPrefix,
  PUBLIC_API_VERSION_SEGMENT_V1,
} from '@/shared/utils/http/api-versioning.util.js';

/** Stable `/api/v1` prefix for inject URLs in tests — do not hardcode `/api/v1`. */
export const TEST_API_V1_PREFIX = buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1);

/**
 * Builds a versioned API path for `fastify.inject()` / inject helpers.
 * @param suffix Path after the version prefix, with or without a leading slash.
 */
export function testApiPath(suffix: string): string {
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${TEST_API_V1_PREFIX}${normalized}`;
}
