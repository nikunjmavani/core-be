import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import type { ApiKeyAuthContext, AuthContext, UserAuthContext } from '@/shared/types/index.js';

/** Returns the per-request id Fastify generates (used for log correlation, audit fields, idempotency). */
export function getRequestIdentifier(request: FastifyRequest): string {
  return request.id;
}

/** Type guard: narrows `auth` to an end-user principal (`kind: 'user'`). */
export function isUserPrincipal(auth: AuthContext): auth is UserAuthContext {
  return auth.kind === 'user';
}

/** Type guard: narrows `auth` to an organization API-key principal (`kind: 'apiKey'`). */
export function isApiKeyPrincipal(auth: AuthContext): auth is ApiKeyAuthContext {
  return auth.kind === 'apiKey';
}

/**
 * Returns the acting **user** public id, or `undefined` for an API-key principal. Use when
 * attributing a write to a user (e.g. `created_by`) so API-key actions resolve to a null user
 * actor rather than a misleading empty string.
 */
export function getActingUserPublicId(auth: AuthContext): string | undefined {
  return auth.kind === 'user' ? auth.userId : undefined;
}

/**
 * Returns a stable actor id for logging / rate-limit bucketing / observability: the user public
 * id for user principals, or the API-key public id for API-key principals. Never empty.
 */
export function getAuthenticatedActorId(auth: AuthContext): string {
  return auth.kind === 'user' ? auth.userId : auth.apiKeyPublicId;
}

/**
 * Returns the authenticated {@link UserAuthContext} for a **user** principal or throws
 * {@link UnauthorizedError}. Use in controllers/services that require a real end user; do not
 * dereference `request.auth` directly.
 *
 * @remarks
 * Intentionally rejects organization API-key principals. Routes that legitimately accept API
 * keys — those guarded by a `requireOrganizationPermission` preHandler — must use
 * {@link requirePrincipal} and narrow with {@link isApiKeyPrincipal} / {@link getActingUserPublicId}.
 */
export function requireAuth(request: FastifyRequest): UserAuthContext {
  const auth = request.auth;
  if (auth?.kind !== 'user') throw new UnauthorizedError();
  return auth;
}

/**
 * Returns the authenticated principal ({@link AuthContext}) for **either** a user or an
 * organization API-key principal, or throws {@link UnauthorizedError}.
 *
 * @remarks
 * Callers that attribute writes to a user must narrow with {@link getActingUserPublicId}
 * (which yields `undefined` for API keys) rather than assuming a `userId` is present. Does
 * **not** replace {@link requireAuth} on user-only routes.
 */
export function requirePrincipal(request: FastifyRequest): AuthContext {
  const auth = request.auth;
  if (!auth) throw new UnauthorizedError();
  return auth;
}
