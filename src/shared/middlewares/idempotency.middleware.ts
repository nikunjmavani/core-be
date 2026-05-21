import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { ValidationError } from '@/shared/errors/index.js';
import {
  buildIdempotencyCacheKey,
  IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY,
  parseIdempotencyKeyHeader,
} from '@/shared/utils/idempotency/idempotency-key.util.js';
import { translateRequestMessage } from '@/shared/utils/i18n/translate-request.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { assertIdempotencyKeyPresentWhenRequired } from '@/shared/utils/idempotency/idempotency-required.util.js';
import {
  IDEMPOTENCY_CACHED_BODY_BYTES,
  IDEMPOTENCY_PLACEHOLDER_TTL_SECONDS,
  IDEMPOTENCY_RESPONSE_CACHE_TTL_SECONDS,
} from '@/shared/constants/index.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface CompletedIdempotencyEntry {
  state: 'completed';
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

interface InFlightIdempotencyEntry {
  state: 'in_flight';
  claimedAt: number;
  requestId?: string;
}

type IdempotencyEntry = CompletedIdempotencyEntry | InFlightIdempotencyEntry;

interface PendingIdempotencyCompletion {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

interface RequestWithIdempotency extends FastifyRequest {
  _idempotencyKey?: string;
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
          headers: completed.headers as Record<string, string>,
        };
      }
    }
    if (parsed && typeof parsed === 'object' && parsed.state === 'in_flight') {
      const inFlight = parsed as Partial<InFlightIdempotencyEntry>;
      return {
        state: 'in_flight',
        claimedAt: typeof inFlight.claimedAt === 'number' ? inFlight.claimedAt : 0,
        ...(typeof inFlight.requestId === 'string' ? { requestId: inFlight.requestId } : {}),
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
  const organizationId =
    organizationFromRequest !== undefined && organizationFromRequest !== null
      ? organizationFromRequest
      : organizationIdFromHeader;

  return omitUndefined({
    userId: authentication?.userId,
    organizationId,
    apiKeyPublicId: authentication?.apiKeyPublicId,
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
 * Short-lived placeholder TTL. Once a real response is computed, `onSend` overwrites the
 * key with the real cached response and the standard 24h TTL. Keeping the in-flight
 * window short avoids 24h "ghost" placeholders if the worker crashes hard before `onSend`
 * runs (and the error-path DEL has not had a chance to execute).
 */
async function idempotencyClaimPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (reply.sent) return;

  const requestWithIdempotency = request as RequestWithIdempotency;
  const idempotencyKey = requestWithIdempotency._idempotencyKey;
  if (!idempotencyKey) return;

  const scope = resolveIdempotencyScope(request);
  const cacheKey = buildIdempotencyCacheKey(idempotencyKey, scope);
  requestWithIdempotency._idempotencyScope = scope;

  let cached: string | null;
  let claimed: 'OK' | null;
  try {
    cached = await redisConnection.get(cacheKey);
    if (cached !== null) {
      const entry = parseIdempotencyEntry(cached);
      if (entry.state === 'completed') {
        return sendCachedIdempotencyResponse(reply, entry);
      }
      return sendInFlightConflict(request, reply);
    }

    const inFlightEntry: InFlightIdempotencyEntry = {
      state: 'in_flight',
      claimedAt: Date.now(),
      requestId: typeof request.id === 'string' ? request.id : String(request.id ?? ''),
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
     * Fail closed: with Redis degraded we cannot guarantee at-most-once execution.
     * Better to surface a 503 than to silently allow concurrent duplicate writes.
     */
    logger.warn({ error, idempotencyKey }, 'idempotency.cache.unavailable');
    const detail = translateRequestMessage(
      request,
      'errors:serviceUnavailable',
      'Idempotency store unavailable',
    );
    reply.status(503);
    reply.send({
      error: {
        type: 'service_error',
        code: 'service_unavailable',
        detail,
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
    await redisConnection.incr(IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY);
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
 * Final-step Redis write. By running here (rather than in `onSend`) the completed cache
 * is only persisted after the request-level transaction has resolved — preventing the
 * documented "rolled-back write replays as 2xx" failure mode. Three terminal cases:
 *
 *  1. statusCode < 400 + pending completion stashed -> overwrite placeholder with completed entry
 *  2. statusCode >= 400 or pending completion absent (handler threw, body too large) -> DEL
 *     placeholder so the client may safely retry
 *  3. claim was never acquired -> no-op
 */
async function idempotencyOnResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const requestWithIdempotency = request as RequestWithIdempotency;
  if (!requestWithIdempotency._idempotencyClaimed) return;

  const idempotencyKey = requestWithIdempotency._idempotencyKey;
  if (!idempotencyKey) return;

  const scope = requestWithIdempotency._idempotencyScope ?? resolveIdempotencyScope(request);
  const cacheKey = buildIdempotencyCacheKey(idempotencyKey, scope);
  requestWithIdempotency._idempotencyClaimed = false;

  const statusCode = reply.statusCode;
  const pending = requestWithIdempotency._idempotencyPendingCompleted;
  if (statusCode < 400 && pending !== undefined) {
    const completed: CompletedIdempotencyEntry = {
      state: 'completed',
      statusCode: pending.statusCode,
      body: pending.body,
      headers: pending.headers,
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

    const existingPreHandlers =
      routeOptions.preHandler === undefined
        ? []
        : Array.isArray(routeOptions.preHandler)
          ? [...routeOptions.preHandler]
          : [routeOptions.preHandler];

    routeOptions.preHandler = [...existingPreHandlers, idempotencyClaimPreHandler];
  });

  application.addHook('onRequest', idempotencyOnRequest);
  application.addHook('onSend', idempotencyOnSend);
  application.addHook('onResponse', idempotencyOnResponse);
};

/** Must break encapsulation so hooks apply to routes registered after middleware on the root app. */
export default fp(idempotencyMiddlewarePlugin, { name: 'idempotency-middleware' });
