import { createHash } from 'node:crypto';

/** Route patterns that must never participate in idempotency caching (token or secret issuance). */
const IDEMPOTENCY_EXCLUDED_ROUTE_PATTERNS: RegExp[] = [
  /^\/login$/,
  /^\/magic-link\/verify$/,
  /^\/mfa\/login$/,
  /^\/oauth\/[^/]+\/callback$/,
  /^\/webauthn\/authenticate\/verify$/,
  /^\/refresh$/,
  /^\/organizations\/[^/]+\/api-keys$/,
];

/** JSON field names whose presence in a cached response body would expose secrets. */
const IDEMPOTENCY_SECRET_RESPONSE_FIELD_NAMES = new Set([
  'access_token',
  'raw_key',
  'mfa_session_token',
  'refresh_token',
]);

/**
 * Normalizes a request path for idempotency fingerprinting: strips the query string and
 * collapses duplicate slashes. Prefer the Fastify route template when available so
 * `/organizations/:id` and concrete ids hash consistently.
 */
export function normalizeIdempotencyRoutePath(routePath: string): string {
  const withoutQuery = routePath.split('?')[0] ?? routePath;
  return withoutQuery.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

/**
 * Builds a stable SHA-256 fingerprint segment from HTTP method, normalized route, and body.
 * Two requests with the same idempotency key but different method, route, or body must not replay.
 */
export function buildIdempotencyRequestFingerprint(parameters: {
  method: string;
  routePath: string;
  body: unknown;
}): string {
  const normalizedRoute = normalizeIdempotencyRoutePath(parameters.routePath);
  const bodySegment =
    parameters.body === undefined || parameters.body === null
      ? ''
      : typeof parameters.body === 'string'
        ? parameters.body
        : JSON.stringify(parameters.body);
  const canonical = `${parameters.method.toUpperCase()}:${normalizedRoute}:${bodySegment}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Returns true when the route must not store or replay idempotent responses (auth/token issuance).
 */
export function isIdempotencyRouteExcluded(routePath: string): boolean {
  const normalized = normalizeIdempotencyRoutePath(routePath);
  return IDEMPOTENCY_EXCLUDED_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function objectContainsSecretField(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => objectContainsSecretField(entry));
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (IDEMPOTENCY_SECRET_RESPONSE_FIELD_NAMES.has(key)) return true;
      if (objectContainsSecretField(nested)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Returns true when a serialized HTTP response body carries token or raw-secret fields and must
 * not be written to the idempotency Redis cache.
 */
export function responseBodyContainsSecretFields(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as unknown;
    return objectContainsSecretField(parsed);
  } catch {
    for (const fieldName of IDEMPOTENCY_SECRET_RESPONSE_FIELD_NAMES) {
      if (body.includes(`"${fieldName}"`)) return true;
    }
    return false;
  }
}
