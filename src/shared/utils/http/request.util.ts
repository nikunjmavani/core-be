import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import type { AuthContext } from '@/shared/types/index.js';

/** Returns the per-request id Fastify generates (used for log correlation, audit fields, idempotency). */
export function getRequestIdentifier(request: FastifyRequest): string {
  return request.id;
}

/**
 * Returns the authenticated `AuthContext` or throws {@link UnauthorizedError}.
 * Use in controllers/services that require an authenticated caller; do not
 * dereference `request.auth` directly.
 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth?.userId) throw new UnauthorizedError();
  return request.auth;
}
