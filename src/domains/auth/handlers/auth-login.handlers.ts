import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthLoginHandlersDependencies = Pick<AuthContainer, 'authService'>;

/** Builds the `POST /api/v1/auth/login` handler — verifies credentials via {@link AuthService.login}, sets the session cookie, records the `auth.login` audit event, and returns either an access token or an `mfa_required` envelope. */
export function createAuthLoginHandlers({ authService }: AuthLoginHandlersDependencies) {
  return {
    login: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request);
      const data = await authService.login(request.body, ipAddress, userAgent ?? undefined);

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);

      try {
        const payload = await verifyAccessToken(data.access_token);
        await recordScopedAuditEvent(request, {
          actorUserPublicId: payload.userId,
          action: 'auth.login',
          resource_type: 'session',
          metadata: { session_public_id: data.session_public_id },
        });
        // Break-glass visibility: every platform super_admin token issued via the
        // credential path is recorded as a high-severity audit event.
        if (payload.role === GLOBAL_ROLES.SUPER_ADMIN) {
          await recordScopedAuditEvent(request, {
            actorUserPublicId: payload.userId,
            action: 'auth.super_admin.token_issued',
            resource_type: 'session',
            severity: 'WARNING',
            metadata: { session_public_id: data.session_public_id, source: 'password_login' },
          });
        }
      } catch (error) {
        logger.warn({ error }, 'audit.login.recording.failed');
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
