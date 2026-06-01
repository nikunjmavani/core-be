import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { ValidationError } from '@/shared/errors/index.js';
import {
  buildIdempotencyCacheKey,
  hasAuthenticatedIdempotencyActor,
  parseIdempotencyKeyHeader,
  selectIdempotencyClaimCounterShardKey,
} from '@/shared/utils/idempotency/idempotency-key.util.js';
import {
  buildIdempotencyRequestFingerprint,
  isIdempotencyRouteExcluded,
  responseBodyContainsSecretFields,
} from '@/shared/utils/idempotency/idempotency-fingerprint.util.js';
import { translateRequestMessage } from '@/shared/utils/i18n/translate-request.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { assertIdempotencyKeyPresentWhenRequired } from '@/shared/utils/idempotency/idempotency-required.util.js';
import {
  IDEMPOTENCY_CACHED_BODY_BYTES,
  IDEMPOTENCY_PLACEHOLDER_TTL_SECONDS,
  IDEMPOTENCY_RESPONSE_CACHE_TTL_SECONDS,
  IDEMPOTENCY_STORE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/shared/constants/index.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Throttle window for the degraded-mode Sentry alert so a Redis outage cannot flood Sentry. */
const IDEMPOTENCY_STORE_UNAVAILABLE_ALERT_INTERVAL_MS = 30_000;
let lastIdempotencyStoreUnavailableAlertAtMs = 0;

/**
 * Surfaces the idempotency store (Redis) being unavailable as a throttled Sentry event so a
 * Redis outage — during which required-idempotency writes fail closed with 503 — actually pages
 * operations instead of only appearing in logs. Throttled to one event per
 * {@link IDEMPOTENCY_STORE_UNAVAILABLE_ALERT_INTERVAL_MS} so a sustained outage does not flood Sentry.
 */
function alertIdempotencyStoreUnavailable(error: unknown): void {
  const now = Date.now();
  if (
    now - lastIdempotencyStoreUnavailableAlertAtMs <
    IDEMPOTENCY_STORE_UNAVAILABLE_ALERT_INTERVAL_MS
  ) {
    return;
  }
  lastIdempotencyStoreUnavailableAlertAtMs = now;
  captureMessage('idempotency.cache.unavailable', {
    level: 'error',
    extra: { error: error instanceof Error ? error.message : String(error) },
  });
}

interface CompletedIdempotencyEntry {
  state: 'completed';
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  /** Fingerprint (method + route + body) of the request that produced this entry; used to reject key reuse with a different payload. */
  fingerprint?: string;
}

interface InFlightIdempotencyEntry {
  state: 'in_flight';
  claimedAt: number;
  requestId?: string;
  /** Fingerprint of the in-flight request; a later request reusing the key with a different fingerprint is rejected. */
  fingerprint?: string;
}

type IdempotencyEntry = CompletedIdempotencyEntry | InFlightIdempotencyEntry;

interface PendingIdempotencyCompletion {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

interface RequestWithIdempotency extends FastifyRequest {
  _idempotencyKey?: string;
  _idempotencyRequestFingerprint?: string;
  _idempotencyScope?: { userId?: string; organizationId?: string; apiKeyPublicId?: string };
  /** Set when this request claimed the placeholder via SETNX. Used to release on error. */
  _idempotencyClaimed?: boolean;
  /** Serialized successful response stashed in onSend; written to Redis in onResponse. */
  _idempotencyPendingCompleted?: PendingIdempotencyCompletion;
}

/**
 * Backward compatible parser: prior versions stored the placeholder as a fully-formed
 * CachedResponse (`{ statusCode: 202, body: '{}', headers: {} }`). Treat any entry that
 * does not explicitly carry `state: 'completed'` as `in_flight` so a rolling deployment
 * does not replay 202 placeholders as real responses.
 */
function parseIdempotencyEntry(raw: string): IdempotencyEntry {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && parsed.state === 'completed') {
      const completed = parsed as Partial<CompletedIdempotencyEntry>;
      if (
        typeof completed.statusCode === 'number' &&
        typeof completed.body === 'string' &&
        completed.headers !== null &&
        typeof completed.headers === 'object'
      ) {
        return {
          state: 'completed',
          statusCode: completed.statusCode,
          body: completed.body,
          headers: completed.headers,
          ...(typeof completed.fingerprint === 'string'
            ? { fingerprint: completed.fingerprint }
            : {}),
        };
      }
    }
    if (parsed && typeof parsed === 'object' && parsed.state === 'in_flight') {
      const inFlight = parsed as Partial<InFlightIdempotencyEntry>;
      return {
        state: 'in_flight',
        claimedAt: typeof inFlight.claimedAt === 'number' ? inFlight.claimedAt : 0,
        ...(typeof inFlight.requestId === 'string' ? { requestId: inFlight.requestId } : {}),
        ...(typeof inFlight.fingerprint === 'string' ? { fingerprint: inFlight.fingerprint } : {}),
      };
    }
    return { state: 'in_flight', claimedAt: 0 };
  } catch {
    return { state: 'in_flight', claimedAt: 0 };
  }
}

function isWriteRouteMethod(method: RouteOptions['method']): boolean {
  if (method === undefined) return false;
  const methods = Array.isArray(method) ? method : [method];
  return methods.some((item) => WRITE_METHODS.has(item));
}

function resolveIdempotencyScope(request: FastifyRequest): {
  userId?: string;
  organizationId?: string;
  apiKeyPublicId?: string;
} {
  const authentication = request.auth;
  const requestWithOrganization = request as FastifyRequest & { organizationId?: string | null };
  const organizationFromRequest = requestWithOrganization.organizationId;
  const organizationHeader = request.headers['x-organization-id'];
  const organizationIdFromHeader =
    typeof organizationHeader === 'string' && organizationHeader.length > 0
      ? organizationHeader
      : undefined;
  const organizationId = organizationFromRequest ?? organizationIdFromHeader;

  return omitUndefined({
    userId: authentication?.kind === 'user' ? authentication.userId : undefined,
    organizationId,
    apiKeyPublicId: authentication?.kind === 'apiKey' ? authentication.apiKeyPublicId : undefined,
  });
}

function sendCachedIdempotencyResponse(
  reply: FastifyReply,
  response: CompletedIdempotencyEntry,
): FastifyReply {
  reply.status(response.statusCode);
  for (const [headerKey, headerValue] of Object.entries(response.headers)) {
    reply.header(headerKey, headerValue);
  }
  reply.header('x-idempotency-replay', 'true');
  return reply.send(JSON.parse(response.body));
}

function sendInFlightConflict(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const detail = translateRequestMessage(
    request,
    'errors:idempotencyKeyInFlight',
    'A request with this idempotency key is still in flight',
  );
  reply.status(409);
  return reply.send({
    error: {
      type: 'request_error',
      code: 'conflict_in_flight',
      detail,
    },
  });
}

/**
 * Rejects a request that reuses an `Idempotency-Key` already associated with a *different* request
 * payload (method + route + body fingerprint mismatch). Returns 422 so the client knows the key was
 * reused incorrectly rather than retrying the same operation — matching Stripe-style semantics and
 * preventing a divergent second operation from executing under the same key.
 */
function sendIdempotencyKeyReuseConflict(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const detail = translateRequestMessage(
    request,
    'errors:idempotencyKeyReuse',
    'This idempotency key was already used with a different request payload',
  );
  reply.status(422);
  return reply.send({
    error: {
      type: 'request_error',
      code: 'idempotency_key_reuse',
      detail,
    },
  });
}

/**
 * Short-lived placeholder TTL. Once a real response is computed, `onSend` overwrites the
 * key with the real cached response and the standard 24h TTL. Keeping the in-flight
 * window short avoids 24h "ghost" placeholders if the worker crashes hard before `onSend`
 * runs (and the error-path DEL has not had a chance to execute).
 */
function resolveIdempotencyRoutePath(request: FastifyRequest): string {
  const routeTemplate = request.routeOptions?.url;
  if (typeof routeTemplate === 'string' && routeTemplate.length > 0) {
    return routeTemplate;
  }
  const pathOnly = request.url?.split('?')[0];
  return pathOnly && pathOnly.length > 0 ? pathOnly : '/';
}

async function idempotencyClaimPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (reply.sent) return;

  const requestWithIdempotency = request as RequestWithIdempotency;
  const idempotencyKey = requestWithIdempotency._idempotencyKey;
  if (!idempotencyKey) return;

  const routePath = resolveIdempotencyRoutePath(request);
  if (isIdempotencyRouteExcluded(routePath)) {
    return;
  }

  const scope = resolveIdempotencyScope(request);
  if (!hasAuthenticatedIdempotencyActor(scope)) {
    /**
     * Never store or replay idempotent responses for unauthenticated callers. Two anonymous
     * callers presenting the same `Idempotency-Key` would otherwise collide on a single
     * `idempotency:none:anonymous:<key>` bucket, letting the second caller receive the first
     * caller's cached (possibly token-bearing) response body. The request still proceeds
     * normally — it simply gets no idempotency dedup.
     */
    return;
  }

  const requestFingerprint = buildIdempotencyRequestFingerprint({
    method: request.method,
    routePath,
    body: request.body,
  });
  requestWithIdempotency._idempotencyRequestFingerprint = requestFingerprint;

  const cacheKey = buildIdempotencyCacheKey(idempotencyKey, scope);
  requestWithIdempotency._idempotencyScope = scope;

  let cached: string | null;
  let claimed: 'OK' | null;
  try {
    cached = await redisConnection.get(cacheKey);
    if (cached !== null) {
      const entry = parseIdempotencyEntry(cached);
      // Same key, different payload → reject (do not execute a divergent second operation).
      // Entries written before this rollout carry no fingerprint; skip the check for them.
      if (entry.fingerprint !== undefined && entry.fingerprint !== requestFingerprint) {
        return sendIdempotencyKeyReuseConflict(request, reply);
      }
      if (entry.state === 'completed') {
        return sendCachedIdempotencyResponse(reply, entry);
      }
      return sendInFlightConflict(request, reply);
    }

    const inFlightEntry: InFlightIdempotencyEntry = {
      state: 'in_flight',
      claimedAt: Date.now(),
      requestId: typeof request.id === 'string' ? request.id : String(request.id ?? ''),
      fingerprint: requestFingerprint,
    };
    claimed = await redisConnection.set(
      cacheKey,
      JSON.stringify(inFlightEntry),
      'EX',
      IDEMPOTENCY_PLACEHOLDER_TTL_SECONDS,
      'NX',
    );
  } catch (error) {
    /**
     * Degraded mode (fail closed, but cleanly retryable): with Redis degraded we cannot
     * guarantee at-most-once execution, so we must not run the handler. Rather than a bare
     * 503 that clients may treat as a hard failure, we advertise an explicit `Retry-After`
     * and flag the error as retryable so well-behaved clients re-issue the same
     * `Idempotency-Key` once the transient Redis blip clears — preserving correctness
     * (no double-processing) while turning a write outage into a brief, self-healing retry.
     */
    logger.warn({ error, idempotencyKey }, 'idempotency.cache.unavailable');
    alertIdempotencyStoreUnavailable(error);
    const detail = translateRequestMessage(
      request,
      'errors:serviceUnavailable',
      'Idempotency store unavailable',
    );
    reply.header('Retry-After', String(IDEMPOTENCY_STORE_UNAVAILABLE_RETRY_AFTER_SECONDS));
    reply.status(503);
    reply.send({
      error: {
        type: 'service_error',
        code: 'service_unavailable',
        detail,
        retryable: true,
        retryAfterSeconds: IDEMPOTENCY_STORE_UNAVAILABLE_RETRY_AFTER_SECONDS,
      },
    });
    return;
  }

  if (!claimed) {
    /**
     * Lost the SETNX race: another concurrent claim landed between our GET miss and SETNX.
     * Re-read so we can tell apart "still computing" (409 in_flight) from "already completed"
     * (replay).
     */
    let raceEntry: IdempotencyEntry | null = null;
    try {
      const rawRace = await redisConnection.get(cacheKey);
      if (rawRace !== null) raceEntry = parseIdempotencyEntry(rawRace);
    } catch (raceError) {
      logger.warn({ error: raceError, idempotencyKey }, 'idempotency.cache.race.read.failed');
    }
    if (raceEntry?.fingerprint !== undefined && raceEntry.fingerprint !== requestFingerprint) {
      return sendIdempotencyKeyReuseConflict(request, reply);
    }
    if (raceEntry?.state === 'completed') {
      return sendCachedIdempotencyResponse(reply, raceEntry);
    }
    const detail = translateRequestMessage(
      request,
      'errors:idempotencyKeyConflict',
      'Concurrent request with same idempotency key',
    );
    reply.status(409);
    reply.send({
      error: {
        type: 'request_error',
        code: 'conflict',
        detail,
      },
    });
    return;
  }

  requestWithIdempotency._idempotencyClaimed = true;

  try {
    /**
     * Spread the claim counter over a fixed shard fan-out instead of one global key so high
     * write throughput (or Redis Cluster) does not turn a single slot into a hot spot. The
     * total is the sum across shards; the cardinality monitor's SCAN is independent of this.
     */
    await redisConnection.incr(selectIdempotencyClaimCounterShardKey());
  } catch (counterError) {
    logger.warn({ error: counterError }, 'idempotency.claim.counter.incr.failed');
  }
}

async function idempotencyOnRequest(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!WRITE_METHODS.has(request.method)) return;

  assertIdempotencyKeyPresentWhenRequired(request);

  const parsed = parseIdempotencyKeyHeader(request.headers['idempotency-key']);
  if (parsed.kind === 'absent') return;
  if (parsed.kind === 'invalid') {
    throw new ValidationError('errors:idempotencyKeyInvalid');
  }

  const requestWithIdempotency = request as RequestWithIdempotency;
  const idempotencyKey = parsed.value;
  requestWithIdempotency._idempotencyKey = idempotencyKey;
}

/**
 * Snapshots the outgoing response so the completed-cache write can run in `onResponse`,
 * after the request-level transaction (or any service-level transaction) has committed.
 *
 * This hook never writes to Redis directly. For error responses or oversize bodies it
 * marks the claim for release (handled in `onResponse`). For successful responses it
 * stashes the snapshot on the request; if the transaction later rolls back at the
 * framework boundary, the snapshot is dropped without persisting a fake replay entry.
 */
async function idempotencyOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  const requestWithIdempotency = request as RequestWithIdempotency;
  const idempotencyKey = requestWithIdempotency._idempotencyKey;
  if (!idempotencyKey) return payload;
  if (!requestWithIdempotency._idempotencyClaimed) return payload;

  const statusCode = reply.statusCode;
  if (statusCode >= 400) {
    /**
     * Leave `_idempotencyClaimed = true` so `onResponse` releases the placeholder. We
     * intentionally do not delete here: `onResponse` is the single owner of Redis
     * mutations once the request enters the response lifecycle, which keeps the
     * "completed cache written iff transaction committed" invariant simple to reason
     * about and to test.
     */
    return payload;
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const bodyByteLength = Buffer.byteLength(body, 'utf8');
  if (bodyByteLength > IDEMPOTENCY_CACHED_BODY_BYTES) {
    logger.warn(
      { idempotencyKey, bodyByteLength, maxBytes: IDEMPOTENCY_CACHED_BODY_BYTES },
      'idempotency.cache.body.too_large',
    );
    /** Force release: oversize bodies fall through to the same path as error responses. */
    delete requestWithIdempotency._idempotencyPendingCompleted;
    return payload;
  }

  if (responseBodyContainsSecretFields(body)) {
    logger.info({ idempotencyKey }, 'idempotency.cache.secret_response_skipped');
    delete requestWithIdempotency._idempotencyPendingCompleted;
    return payload;
  }

  requestWithIdempotency._idempotencyPendingCompleted = {
    statusCode,
    body,
    headers: {
      'content-type': String(reply.getHeader('content-type') ?? 'application/json'),
    },
  };

  return payload;
}

/**
 * Options for {@link idempotencyOnResponse}. The request-lifecycle coordinator sets
 * `forceRelease` when a 2xx response was produced but the underlying RLS/business
 * transaction ultimately rolled back, so the cached entry must not be written.
 */
export type IdempotencyOnResponseOptions = {
  /**
   * When true, always delete the in-flight placeholder and never persist a completed cache
   * entry — used when the HTTP response was 2xx but the request DB transaction did not commit.
   */
  forceRelease?: boolean;
};

/**
 * Final-step Redis write. By running here (rather than in `onSend`) the completed cache
 * is only persisted after the request-level transaction has resolved — preventing the
 * documented "rolled-back write replays as 2xx" failure mode. Three terminal cases:
 *
 *  1. statusCode < 400 + pending completion stashed -> overwrite placeholder with completed entry
 *  2. statusCode >= 400 or pending completion absent (handler threw, body too large) -> DEL
 *     placeholder so the client may safely retry
 *  3. claim was never acquired -> no-op
 */
export async function idempotencyOnResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  options?: IdempotencyOnResponseOptions,
): Promise<void> {
  const requestWithIdempotency = request as RequestWithIdempotency;
  if (!requestWithIdempotency._idempotencyClaimed) return;

  const idempotencyKey = requestWithIdempotency._idempotencyKey;
  if (!idempotencyKey) return;

  const scope = requestWithIdempotency._idempotencyScope ?? resolveIdempotencyScope(request);
  const requestFingerprint = requestWithIdempotency._idempotencyRequestFingerprint;
  const cacheKey = buildIdempotencyCacheKey(idempotencyKey, scope);
  requestWithIdempotency._idempotencyClaimed = false;

  const statusCode = reply.statusCode;
  const pending = requestWithIdempotency._idempotencyPendingCompleted;
  if (options?.forceRelease === true) {
    delete requestWithIdempotency._idempotencyPendingCompleted;
    try {
      await redisConnection.del(cacheKey);
    } catch (error) {
      logger.warn({ error, idempotencyKey }, 'idempotency.cache.release.failed');
    }
    return;
  }

  if (statusCode < 400 && pending !== undefined) {
    const completed: CompletedIdempotencyEntry = {
      state: 'completed',
      statusCode: pending.statusCode,
      body: pending.body,
      headers: pending.headers,
      ...(requestFingerprint !== undefined ? { fingerprint: requestFingerprint } : {}),
    };
    try {
      await redisConnection.set(
        cacheKey,
        JSON.stringify(completed),
        'EX',
        IDEMPOTENCY_RESPONSE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn({ error, idempotencyKey }, 'idempotency.cache.set.failed');
    }
    delete requestWithIdempotency._idempotencyPendingCompleted;
    return;
  }

  delete requestWithIdempotency._idempotencyPendingCompleted;
  try {
    await redisConnection.del(cacheKey);
  } catch (error) {
    logger.warn({ error, idempotencyKey }, 'idempotency.cache.release.failed');
  }
}

/**
 * Idempotency middleware for POST/PUT/PATCH/DELETE requests.
 *
 * When a client sends an `Idempotency-Key` header, the response is cached
 * in Redis for 24 hours using SETNX to prevent race conditions. Subsequent
 * requests with the same key return the cached response without
 * re-executing the handler.
 *
 * The SETNX claim runs in a route `preHandler` appended via `onRoute`, after
 * route authentication preHandlers, so unauthenticated requests do not occupy
 * Redis keys.
 */
const idempotencyMiddlewarePlugin: FastifyPluginAsync = async (application) => {
  application.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (!isWriteRouteMethod(routeOptions.method)) return;

    const existingPreHandlers = (() => {
      if (routeOptions.preHandler === undefined) return [];
      if (Array.isArray(routeOptions.preHandler)) return [...routeOptions.preHandler];
      return [routeOptions.preHandler];
    })();

    routeOptions.preHandler = [...existingPreHandlers, idempotencyClaimPreHandler];
  });

  application.addHook('onRequest', idempotencyOnRequest);
  application.addHook('onSend', idempotencyOnSend);
  // The post-response cache write is dispatched by request-lifecycle.middleware.ts so it
  // runs strictly AFTER the RLS transaction has committed/rolled back. Registering an
  // `onResponse` hook here would run too early (Fastify onResponse is FIFO).
};

/** Must break encapsulation so hooks apply to routes registered after middleware on the root app. */
export default fp(idempotencyMiddlewarePlugin, { name: 'idempotency-middleware' });
