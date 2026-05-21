import type { FastifyRequest } from 'fastify';
import { UnprocessableEntityError } from '@/shared/errors/index.js';
import { parseIdempotencyKeyHeader } from '@/shared/utils/idempotency/idempotency-key.util.js';

type RouteConfigWithIdempotency = {
  idempotencyRequired?: boolean;
};

export function isIdempotencyKeyRequiredForRequest(request: FastifyRequest): boolean {
  const routeConfig = request.routeOptions?.config as RouteConfigWithIdempotency | undefined;
  return routeConfig?.idempotencyRequired === true;
}

export function assertIdempotencyKeyPresentWhenRequired(request: FastifyRequest): void {
  if (!isIdempotencyKeyRequiredForRequest(request)) return;

  const parsed = parseIdempotencyKeyHeader(request.headers['idempotency-key']);
  if (parsed.kind === 'absent') {
    throw new UnprocessableEntityError('errors:idempotencyKeyRequired');
  }
  if (parsed.kind === 'invalid') {
    throw new UnprocessableEntityError('errors:idempotencyKeyInvalid');
  }
}
