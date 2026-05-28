import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const DEFAULT_REDIS_PORT = 6379;

/** Normalized fields of a Redis connection URL — produced by {@link parseRedisUrl}. */
export type ParsedRedisUrl = {
  host: string;
  port: number;
  password?: string;
  databaseIndex: number;
};

/** True when the Redis URL explicitly uses TLS (`rediss://`). */
export function isRedisTlsUrl(redisUrl: string): boolean {
  return redisUrl.toLowerCase().startsWith('rediss://');
}

/**
 * Parses a `redis://` or `rediss://` URL into host/port/password/database fields.
 * Uses `new URL()` after a scheme rewrite so percent-encoded passwords decode correctly,
 * defaults the database index to 0 when the path is empty, and throws on a non-finite or
 * negative database segment.
 */
export function parseRedisUrl(redisUrl: string): ParsedRedisUrl {
  const normalizedUrl = new URL(redisUrl.replace(/^redis:\/\//, 'http://'));
  const databasePath = normalizedUrl.pathname.replace(/^\//, '');
  const databaseIndex = databasePath.length > 0 ? Number.parseInt(databasePath, 10) : 0;
  if (!Number.isFinite(databaseIndex) || databaseIndex < 0) {
    throw new Error(`redis.invalid_database_index:${redisUrl}`);
  }
  const password = normalizedUrl.password ? decodeURIComponent(normalizedUrl.password) : undefined;

  return omitUndefined({
    host: normalizedUrl.hostname,
    port: normalizedUrl.port ? Number.parseInt(normalizedUrl.port, 10) : DEFAULT_REDIS_PORT,
    password,
    databaseIndex,
  });
}

/** Hostname from a Redis URL (no env dependency). */
export function resolveRedisHostFromUrl(redisUrl: string): string {
  return parseRedisUrl(redisUrl).host;
}

/**
 * When REDIS_BULLMQ_URL is unset, BullMQ shares REDIS_URL.
 */
export function deriveBullMqRedisUrlFromCacheUrl(cacheRedisUrl: string): string {
  return cacheRedisUrl;
}

function normalizeRedisUrlForComparison(redisUrl: string): string {
  const parsed = parseRedisUrl(redisUrl);
  const passwordSegment = parsed.password ? ':***@' : '';
  return `redis://${passwordSegment}${parsed.host}:${parsed.port}/${parsed.databaseIndex}`;
}

/** True when cache and BullMQ URLs resolve to different Redis hosts. */
export function usesSeparateBullMqRedisHost(
  cacheRedisUrl: string,
  bullMqRedisUrl: string,
): boolean {
  return resolveRedisHostFromUrl(cacheRedisUrl) !== resolveRedisHostFromUrl(bullMqRedisUrl);
}

/** True when cache and BullMQ use different logical databases or hosts. */
export function usesSeparateBullMqRedisEndpoint(
  cacheRedisUrl: string,
  bullMqRedisUrl: string,
): boolean {
  return (
    normalizeRedisUrlForComparison(cacheRedisUrl) !== normalizeRedisUrlForComparison(bullMqRedisUrl)
  );
}

/**
 * Production topology currently allows a single shared Redis instance.
 */
export function validateProductionRedisTopology(
  cacheRedisUrl: string,
  bullMqRedisUrl: string | undefined,
): boolean {
  if (!bullMqRedisUrl?.trim()) {
    return true;
  }
  return (
    normalizeRedisUrlForComparison(cacheRedisUrl) === normalizeRedisUrlForComparison(bullMqRedisUrl)
  );
}
