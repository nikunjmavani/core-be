import type { FastifyReply, FastifyRequest } from 'fastify';
import { translateMessageKeyPayload } from '@/shared/utils/i18n/i18n-response.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import { recordLoginAuditEvent } from '@/domains/auth/shared/audit-login.util.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthMagicLinkHandlersDependencies = Pick<AuthContainer, 'magicLinkService'>;

/** Builds the magic-link Fastify handlers: `sendMagicLink` (enqueues the `AUTH_EVENT.MAGIC_LINK_REQUESTED` email) and `verifyMagicLink` (consumes the token, mints a session, sets the cookie). */
export function createAuthMagicLinkHandlers({
  magicLinkService,
}: AuthMagicLinkHandlersDependencies) {
  return {
    sendMagicLink: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = await magicLinkService.send(request.body, {
        requestId: getRequestIdentifier(request),
      });
      const translated = translateMessageKeyPayload(request, data);
      return successResponse(
        AuthSerializer.magicLinkSent({
          message: translated.message,
          expires_in_minutes: data.expires_in_minutes,
        }),
        getRequestIdentifier(request),
      );
    },
    verifyMagicLink: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await magicLinkService.verify(request.body, ipAddress, userAgent);

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      if (
        'session_public_id' in data &&
        typeof data.session_public_id === 'string' &&
        'session_refresh_secret' in data &&
        typeof data.session_refresh_secret === 'string'
      ) {
        setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
        // sec-A8: audit every login surface, not just password login.
        if ('access_token' in data && typeof data.access_token === 'string') {
          await recordLoginAuditEvent(
            request,
            { access_token: data.access_token, session_public_id: data.session_public_id },
            'magic_link',
          );
        }
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
