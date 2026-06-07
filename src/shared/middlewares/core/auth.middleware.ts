import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { AuthContext } from '@/shared/types/index.js';
import { GLOBAL_ROLES, type GlobalRole } from '@/shared/constants/roles.constants.js';
import { resolveGlobalRoleForEmail } from '@/shared/utils/auth/global-admin-role.util.js';
import { applyApiKeyAuthentication } from '@/shared/middlewares/security/api-key-auth.middleware.js';

function getBearerToken(request: FastifyRequest): string {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader) throw new UnauthorizedError('errors:missingAuthorizationHeader');
  const match = /^Bearer\s+(\S.*)$/i.exec(authorizationHeader);
  if (!match) throw new UnauthorizedError('errors:invalidAuthorizationHeaderFormat');
  return match[1]!;
}

/**
 * Re-derives the per-request role when the JWT carries `SUPER_ADMIN` (sec-A6).
 *
 * @remarks
 * The JWT bakes in `super_admin` at sign-time from the then-current `GLOBAL_ADMIN_EMAILS`.
 * Without this check, removing an email from the allowlist takes up to
 * `GLOBAL_ADMIN_ACCESS_TOKEN_EXPIRY_SECONDS` (default 5 min) to take effect — meaningful
 * during an active incident response. The middleware now re-derives super_admin against
 * the live allowlist on every request and downgrades on mismatch.
 *
 * Hot-path safe: only fires when the JWT actually claims SUPER_ADMIN (rare in production),
 * and reuses the existing `findUserRecordByPublicId` resolver. On any failure to resolve
 * the user, fails closed (downgrades to no role) so a missing user record cannot retain
 * admin privileges. When the user-domain is not wired (minimal test harness without
 * `userDomain` decoration), the role is preserved — production always wires it.
 */
async function rederiveSuperAdminRole(
  request: FastifyRequest,
  userPublicId: string,
): Promise<GlobalRole | undefined> {
  const userService = request.server.userDomain?.userService;
  if (!userService) {
    return GLOBAL_ROLES.SUPER_ADMIN;
  }
  const user = await userService.findUserRecordByPublicId(userPublicId);
  if (!user) return undefined;
  const currentGlobalRole = resolveGlobalRoleForEmail(user.email);
  if (currentGlobalRole === GLOBAL_ROLES.SUPER_ADMIN) {
    return GLOBAL_ROLES.SUPER_ADMIN;
  }
  // Email no longer in the allowlist — downgrade to USER if the account is still active,
  // otherwise drop the role entirely.
  return user.status === 'ACTIVE' ? GLOBAL_ROLES.USER : undefined;
}

async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.auth) {
    return;
  }

  const apiKeyAuthenticated = await applyApiKeyAuthentication(request);
  if (apiKeyAuthenticated) {
    return;
  }

  const token = getBearerToken(request);

  try {
    const payload = await verifyAccessToken(token);

    const authSessionService = request.server.authDomain?.authSessionService;
    if (!authSessionService) {
      throw new UnauthorizedError('errors:validation.invalidToken');
    }

    // sec-new-A2: pass userPublicId so verifyActiveAccessToken can check user.status
    // on every DB-path validation (cache miss), reducing suspension propagation to ≤60 s.
    const { sessionPublicId } = await authSessionService.verifyActiveAccessToken(
      token,
      payload.userId,
    );

    // sec-A6: re-derive SUPER_ADMIN per request so removal from GLOBAL_ADMIN_EMAILS
    // takes effect immediately, not at next token refresh (default 5-minute window).
    // Regular users skip the lookup — preserves the existing hot-path latency.
    const claimedRole = payload.role ? (payload.role as GlobalRole) : undefined;
    const effectiveRole =
      claimedRole === GLOBAL_ROLES.SUPER_ADMIN
        ? await rederiveSuperAdminRole(request, payload.userId)
        : claimedRole;

    request.auth = omitUndefined({
      kind: 'user',
      userId: payload.userId,
      role: effectiveRole,
      sessionPublicId,
    }) as AuthContext;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('errors:validation.invalidToken');
  }
}

const authMiddleware: FastifyPluginAsync = async (app) => {
  app.decorateRequest('auth', null);
  app.decorate('authenticate', authenticate);
};

export default fp(authMiddleware, { name: 'auth-middleware' });
