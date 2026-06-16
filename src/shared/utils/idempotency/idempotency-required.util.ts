import type { FastifyRequest } from 'fastify';
import { UnprocessableEntityError } from '@/shared/errors/index.js';
import { parseIdempotencyKeyHeader } from '@/shared/utils/idempotency/idempotency-key.util.js';

type RouteConfigWithIdempotency = {
  idempotencyRequired?: boolean;
};

/** Returns true when the route was registered with `config.idempotencyRequired = true`. */
export function isIdempotencyKeyRequiredForRequest(request: FastifyRequest): boolean {
  const routeConfig = request.routeOptions?.config as RouteConfigWithIdempotency | undefined;
  return routeConfig?.idempotencyRequired === true;
}

/**
 * For routes that opted in via `idempotencyRequired`, throws
 * {@link UnprocessableEntityError} when the `X-Idempotency-Key` header is
 * missing or malformed; no-op otherwise.
 */
export function assertIdempotencyKeyPresentWhenRequired(request: FastifyRequest): void {
  if (!isIdempotencyKeyRequiredForRequest(request)) return;

  const parsed = parseIdempotencyKeyHeader(request.headers['x-idempotency-key']);
  if (parsed.kind === 'absent') {
    throw new UnprocessableEntityError('errors:idempotencyKeyRequired');
  }
  if (parsed.kind === 'invalid') {
    throw new UnprocessableEntityError('errors:idempotencyKeyInvalid');
  }
}
