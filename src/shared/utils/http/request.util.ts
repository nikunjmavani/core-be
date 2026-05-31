import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import type { AuthContext } from '@/shared/types/index.js';

/** Returns the per-request id Fastify generates (used for log correlation, audit fields, idempotency). */
export function getRequestIdentifier(request: FastifyRequest): string {
  return request.id;
}

/**
 * Returns the authenticated `AuthContext` for a **user** principal or throws
 * {@link UnauthorizedError}. Use in controllers/services that require a real
 * end user (a non-empty `userId`); do not dereference `request.auth` directly.
 *
 * @remarks
 * Intentionally rejects organization API-key principals (which carry an empty
 * `userId`). Routes that legitimately accept API keys — those guarded by a
 * {@link requireOrganizationPermission} preHandler — must use
 * {@link requirePrincipal} instead so the controller does not break on the
 * empty `userId` an API-key principal carries.
 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth?.userId) throw new UnauthorizedError();
  return request.auth;
}

/**
 * Returns the authenticated `AuthContext` for **either** a user or an
 * organization API-key principal, or throws {@link UnauthorizedError}.
 *
 * @remarks
 * A user principal carries a non-empty `userId`; an organization API-key
 * principal carries an empty `userId` plus an `apiKeyPublicId`. Use this in
 * controllers reachable via an org API key (those behind a
 * `requireOrganizationPermission` preHandler) so the request succeeds
 * end-to-end. When attributing writes, callers should read `auth.userId`,
 * which is the user public id for users and an empty string for API keys
 * (resolved downstream to a null actor). Does **not** replace
 * {@link requireAuth} on user-only routes.
 */
export function requirePrincipal(request: FastifyRequest): AuthContext {
  if (!(request.auth?.userId || request.auth?.apiKeyPublicId)) throw new UnauthorizedError();
  return request.auth;
}
