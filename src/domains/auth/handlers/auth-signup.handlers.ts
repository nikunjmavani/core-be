import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import { recordLoginAuditEvent } from '@/domains/auth/shared/audit-login.util.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthSignupHandlersDependencies = Pick<AuthContainer, 'authService'>;

/** Builds the `POST /api/v1/auth/signup` handler — creates the email/password account via {@link AuthService.signup}, sets the session cookie, records the `auth.login` audit event, and returns the access token (or an `mfa_required` envelope). */
export function createAuthSignupHandlers({ authService }: AuthSignupHandlersDependencies) {
  return {
    signup: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request);
      const data = await authService.signup(request.body, ipAddress, userAgent ?? undefined);

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
      await recordLoginAuditEvent(request, data, 'password');

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
