import type { FastifyReply, FastifyRequest } from 'fastify';
import { translateMessageKeyPayload } from '@/shared/utils/i18n/i18n-response.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from './auth.http.util.js';
import { AuthSerializer } from './auth.serializer.js';
import type { AuthContainer } from './auth.container.js';

type AuthMagicLinkHandlersDependencies = Pick<AuthContainer, 'magicLinkService'>;

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
          ...(data.token !== undefined ? { token: data.token } : {}),
        }),
        getRequestIdentifier(request),
      );
    },
    verifyMagicLink: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await magicLinkService.verify(request.body, ipAddress, userAgent);

      if ('session_public_id' in data && typeof data.session_public_id === 'string') {
        setSessionCookie(reply, data.session_public_id);
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
  };
}
