import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const DEFAULT_REDIS_PORT = 6379;

/** Normalized fields of a Redis connection URL — produced by {@link parseRedisUrl}. */
export type ParsedRedisUrl = {
  host: string;
  port: number;
  password?: string;
  databaseIndex: number;
};

/** True when the Redis URL explicitly uses TLS (`rediss://`). A falsy/absent URL is not TLS. */
export function isRedisTlsUrl(redisUrl: string | undefined): boolean {
  return typeof redisUrl === 'string' && redisUrl.toLowerCase().startsWith('rediss://');
}

/** RFC 1918 private IPv4 ranges (10/8, 172.16/12, 192.168/16) plus loopback. */
const PRIVATE_IPV4_PATTERN = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/**
 * True when the Redis host sits on a trusted private/internal network where plaintext
 * `redis://` is acceptable (Railway private networking, Kubernetes cluster DNS, loopback,
 * RFC 1918). Public endpoints reached over untrusted networks must use `rediss://`.
 *
 * @remarks
 * - **Algorithm:** matches loopback names, `*.railway.internal` / `*.internal` /
 *   `*.local` / `*.cluster.local` suffixes, and RFC 1918 / IPv6 loopback literals.
 * - **Side effects:** none — pure string parsing.
 */
export function isPrivateOrInternalRedisHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  if (normalizedHost.length === 0) return false;
  if (normalizedHost === 'localhost' || normalizedHost === '::1') return true;
  if (
    normalizedHost.endsWith('.railway.internal') ||
    normalizedHost.endsWith('.internal') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.cluster.local')
  ) {
    return true;
  }
  return PRIVATE_IPV4_PATTERN.test(normalizedHost);
}

/** ioredis TLS options applied when (and only when) the Redis URL uses `rediss://`. */
export type RedisTlsOptions = { tls: { rejectUnauthorized: true } } | Record<string, never>;

/**
 * Builds the ioredis `tls` option for a Redis URL. When the URL is `rediss://`, returns
 * `{ tls: { rejectUnauthorized: true } }` so the server certificate chain is explicitly
 * verified (ioredis otherwise relies on Node's default, which this makes intentional and
 * tamper-evident). For plaintext `redis://` URLs it returns an empty object so no TLS
 * handshake is attempted.
 */
export function buildRedisTlsOptions(redisUrl: string | undefined): RedisTlsOptions {
  return isRedisTlsUrl(redisUrl) ? { tls: { rejectUnauthorized: true } } : {};
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
 * Validates the configured Redis topology.
 *
 * A dedicated `REDIS_BULLMQ_URL` endpoint is fully supported (and recommended for
 * production) so a BullMQ backlog cannot starve the write-critical cache /
 * idempotency / rate-limit store that lives on `REDIS_URL`. When the override is
 * unset, BullMQ shares `REDIS_URL`, which keeps local development single-instance.
 * The only constraint is that an override, when present, must be a parseable
 * `redis://` / `rediss://` URL — a different host or logical database is allowed.
 */
export function validateProductionRedisTopology(
  _cacheRedisUrl: string,
  bullMqRedisUrl: string | undefined,
): boolean {
  if (!bullMqRedisUrl?.trim()) {
    return true;
  }
  try {
    parseRedisUrl(bullMqRedisUrl);
    return true;
  } catch {
    return false;
  }
}
