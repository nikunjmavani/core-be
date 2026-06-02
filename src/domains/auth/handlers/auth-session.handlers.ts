import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { requireAllowedSourceOriginForCookieSessionRoute } from '@/shared/middlewares/session/cookie-session-origin.pre-handler.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import {
  clearSessionCookie,
  parseSessionCookieValue,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import { serializeAuthSessions } from '@/domains/auth/sub-domains/auth-session/auth-session.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthSessionHandlersDependencies = Pick<AuthContainer, 'authService' | 'authSessionService'>;

/** Builds the session-management Fastify handlers: `logout`, `refreshToken` (cookie + origin allowlist), `listSessions`, `revokeSession`, and `revokeAllSessions`. */
export function createAuthSessionHandlers({
  authService,
  authSessionService,
}: AuthSessionHandlersDependencies) {
  return {
    logout: async (request: FastifyRequest, reply: FastifyReply) => {
      const authorizationHeader = request.headers.authorization;
      const match = authorizationHeader?.match(/^Bearer\s+(\S.*)$/i);
      const token = match?.[1];
      if (!token) {
        throw new UnauthorizedError('errors:missingAuthorizationHeader');
      }

      let actorUserPublicId: string | undefined;
      try {
        const payload = await verifyAccessToken(token);
        actorUserPublicId = payload.userId;
      } catch {
        // proceed with logout even if token is expired
      }

      await authService.logout(token);

      if (actorUserPublicId) {
        await recordScopedAuditEvent(request, {
          actorUserPublicId,
          action: 'auth.logout',
          resource_type: 'session',
        });
      }

      clearSessionCookie(reply);

      return reply.code(204).send();
    },
    listSessions: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authSessionService.list(auth.userId);
      return successResponse(serializeAuthSessions(data), getRequestIdentifier(request));
    },
    revokeSession: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      await authSessionService.revoke(auth.userId, request.params.id);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.session.revoke',
        resource_type: 'session',
        metadata: { session_public_id: request.params.id },
      });
      return reply.code(204).send();
    },
    refreshToken: async (request: FastifyRequest, reply: FastifyReply) => {
      requireAllowedSourceOriginForCookieSessionRoute(request);
      // eslint-disable-next-line security/detect-object-injection -- SESSION_COOKIE_NAME is a constant.
      const rawSessionCookie = request.cookies?.[SESSION_COOKIE_NAME];
      const parsedSession = rawSessionCookie ? parseSessionCookieValue(rawSessionCookie) : null;
      if (!parsedSession) {
        throw new UnauthorizedError('errors:missingSessionCookie');
      }
      const data = await authService.refreshToken({
        sessionPublicId: parsedSession.sessionPublicId,
        refreshSecret: parsedSession.refreshSecret,
      });
      setSessionCookie(reply, parsedSession.sessionPublicId, data.refresh_secret);
      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
    revokeAllSessions: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      await authSessionService.revokeAllSessions(auth.userId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.session.revoke_all',
        resource_type: 'session',
      });

      clearSessionCookie(reply);

      return reply.code(204).send();
    },
  };
}
