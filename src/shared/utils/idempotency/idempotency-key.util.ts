/** Maximum length after trim; Stripe-style keys are typically shorter. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Redis counter (logical key); does not match cache entries under `idempotency:` namespaces. */
export const IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY = 'idempotency-claim-counter';

/** Logical SCAN/WAIT pattern for cache keys (ioredis applies Redis key prefix). */
export const IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN = 'idempotency:*';

const IDEMPOTENCY_KEY_BODY_PATTERN = /^[A-Za-z0-9._:~+/=-]+$/;

export type ParsedIdempotencyKeyHeader =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: string };

/**
 * Parses and validates `Idempotency-Key` header value.
 */
export function parseIdempotencyKeyHeader(
  headerValue: string | string[] | undefined,
): ParsedIdempotencyKeyHeader {
  if (headerValue === undefined) return { kind: 'absent' };
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== 'string') return { kind: 'absent' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'absent' };
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) return { kind: 'invalid' };
  if (!IDEMPOTENCY_KEY_BODY_PATTERN.test(trimmed)) return { kind: 'invalid' };
  return { kind: 'valid', value: trimmed };
}

/**
 * Builds a scoped Redis key for idempotency caching.
 * Keys are namespaced by actor and organization to prevent cross-tenant replay.
 */
export function buildIdempotencyCacheKey(
  idempotencyKey: string,
  scope: { userId?: string; organizationId?: string; apiKeyPublicId?: string },
): string {
  const actorSegment =
    scope.apiKeyPublicId && scope.apiKeyPublicId.length > 0
      ? `api-key:${scope.apiKeyPublicId}`
      : scope.userId && scope.userId.length > 0
        ? scope.userId
        : 'anonymous';
  const organizationSegment = scope.organizationId ?? 'none';
  return `idempotency:${organizationSegment}:${actorSegment}:${idempotencyKey}`;
}
