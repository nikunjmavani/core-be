import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { requireAllowedSourceOriginForCookieSessionRoute } from '@/shared/middlewares/cookie-session-origin.pre-handler.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import { clearSessionCookie, SESSION_COOKIE_NAME, setCsrfCookie } from './auth.http.util.js';
import { AuthSerializer } from './auth.serializer.js';
import type { AuthContainer } from './auth.container.js';

type AuthSessionHandlersDependencies = Pick<AuthContainer, 'authService' | 'authSessionService'>;

export function createAuthSessionHandlers({
  authService,
  authSessionService,
}: AuthSessionHandlersDependencies) {
  return {
    logout: async (request: FastifyRequest, reply: FastifyReply) => {
      const authorizationHeader = request.headers.authorization;
      const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
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
      return successResponse(data, getRequestIdentifier(request));
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
      const sessionPublicId = request.cookies?.[SESSION_COOKIE_NAME];
      if (!sessionPublicId) {
        throw new UnauthorizedError('errors:missingSessionCookie');
      }
      const data = await authService.refreshToken(sessionPublicId);
      setCsrfCookie(reply);
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
