/** Maximum length after trim; Stripe-style keys are typically shorter. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Redis counter (logical key); does not match cache entries under `idempotency:` namespaces. */
export const IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY = 'idempotency-claim-counter';

/**
 * Number of shards the per-request claim counter is spread across.
 *
 * @remarks
 * The claim counter is incremented on every successful idempotent write. Writing to a single
 * Redis key turns that key into a hot slot under high write throughput (and a single-slot
 * bottleneck on Redis Cluster). Spreading increments over a small, fixed fan-out of shard keys
 * keeps writes off one slot while staying bounded (a handful of long-lived counter keys).
 */
export const IDEMPOTENCY_CLAIM_COUNTER_SHARD_COUNT = 16;

/** Logical SCAN/WAIT pattern for cache keys (ioredis applies Redis key prefix). */
export const IDEMPOTENCY_CACHE_KEY_MATCH_PATTERN = 'idempotency:*';

const IDEMPOTENCY_KEY_BODY_PATTERN = /^[A-Za-z0-9._:~+/=-]+$/;

/** Discriminated result from {@link parseIdempotencyKeyHeader}: present-valid, present-invalid, or absent. */
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

/** Actor/organization scope resolved for an idempotent request. */
export interface IdempotencyScope {
  userId?: string;
  organizationId?: string;
  apiKeyPublicId?: string;
}

/**
 * Returns `true` when the request carries an authenticated actor (a user or an API key).
 *
 * @remarks
 * Idempotency caching is only safe when responses can be scoped to a stable, trusted actor.
 * Unauthenticated callers share the `idempotency:none:anonymous:<key>` bucket, so two distinct
 * anonymous callers presenting the same `Idempotency-Key` would collide and the second caller
 * could be served the first caller's cached (possibly token-bearing) response body. The
 * organization segment is intentionally ignored here because an unauthenticated request can set
 * the `X-Organization-Id` header without proving membership.
 */
export function hasAuthenticatedIdempotencyActor(scope: IdempotencyScope): boolean {
  const hasApiKey = typeof scope.apiKeyPublicId === 'string' && scope.apiKeyPublicId.length > 0;
  const hasUser = typeof scope.userId === 'string' && scope.userId.length > 0;
  return hasApiKey || hasUser;
}

/**
 * Builds the Redis key for a single claim-counter shard.
 *
 * @remarks
 * Shard keys are siblings of {@link IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY} under a `:shard:`
 * suffix so they remain easy to enumerate and never overlap the `idempotency:*` cache namespace.
 */
export function buildIdempotencyClaimCounterShardKey(shardIndex: number): string {
  return `${IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY}:shard:${shardIndex}`;
}

/**
 * Picks a pseudo-random claim-counter shard key so concurrent claims spread across shards
 * instead of contending on one hot Redis slot.
 *
 * @remarks
 * Uses `Math.random` deliberately: shard selection only needs even-ish spread for load, not
 * cryptographic unpredictability. The total claim count is the sum across all shards.
 */
export function selectIdempotencyClaimCounterShardKey(): string {
  const shardIndex = Math.floor(Math.random() * IDEMPOTENCY_CLAIM_COUNTER_SHARD_COUNT);
  return buildIdempotencyClaimCounterShardKey(shardIndex);
}

/**
 * Builds a scoped Redis key for idempotency caching.
 * Keys are namespaced by actor and organization to prevent cross-tenant replay.
 */
export function buildIdempotencyCacheKey(idempotencyKey: string, scope: IdempotencyScope): string {
  const actorSegment =
    scope.apiKeyPublicId && scope.apiKeyPublicId.length > 0
      ? `api-key:${scope.apiKeyPublicId}`
      : scope.userId && scope.userId.length > 0
        ? scope.userId
        : 'anonymous';
  const organizationSegment = scope.organizationId ?? 'none';
  return `idempotency:${organizationSegment}:${actorSegment}:${idempotencyKey}`;
}
