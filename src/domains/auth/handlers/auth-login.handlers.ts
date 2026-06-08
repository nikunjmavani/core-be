import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import {
  recordLoginAuditEvent,
  recordLoginFailureAuditEvent,
} from '@/domains/auth/shared/audit-login.util.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthLoginHandlersDependencies = Pick<AuthContainer, 'authService'>;

/** Builds the `POST /api/v1/auth/login` handler — verifies credentials via {@link AuthService.login}, sets the session cookie, records the `auth.login` audit event, and returns either an access token or an `mfa_required` envelope. */
export function createAuthLoginHandlers({ authService }: AuthLoginHandlersDependencies) {
  return {
    login: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request);
      let data: Awaited<ReturnType<typeof authService.login>>;
      try {
        data = await authService.login(request.body, ipAddress, userAgent ?? undefined);
      } catch (error) {
        // sec-A8 follow-up: record the failure side of the OVERVIEW invariant
        // ("every login (success or failure) records a row"). The helper is
        // best-effort and never throws — we always re-raise the original error
        // so the global error handler maps it to the right HTTP status.
        await recordLoginFailureAuditEvent(request, 'password', error);
        throw error;
      }

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);

      await recordLoginAuditEvent(request, data, 'password');

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
