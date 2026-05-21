import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from './auth.http.util.js';
import { AuthSerializer } from './auth.serializer.js';
import type { AuthContainer } from './auth.container.js';

type AuthLoginHandlersDependencies = Pick<AuthContainer, 'authService'>;

export function createAuthLoginHandlers({ authService }: AuthLoginHandlersDependencies) {
  return {
    login: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request);
      const data = await authService.login(request.body, ipAddress, userAgent ?? undefined);

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      setSessionCookie(reply, data.session_public_id);

      try {
        const payload = await verifyAccessToken(data.access_token);
        await recordScopedAuditEvent(request, {
          actorUserPublicId: payload.userId,
          action: 'auth.login',
          resource_type: 'session',
          metadata: { session_public_id: data.session_public_id },
        });
      } catch (error) {
        logger.warn({ error }, 'audit.login.recording.failed');
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
