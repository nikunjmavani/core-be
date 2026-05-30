import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import {
  getIpAddress,
  getUserAgent,
  isOauthProviderNotImplementedError,
  sendOauthProviderNotImplementedResponse,
  setSessionCookie,
} from '../auth.http.util.js';
import type { OauthCallbackQueryInput } from '../auth.dto.js';
import { AuthSerializer } from '../auth.serializer.js';
import type { AuthContainer } from '../auth.container.js';

type AuthOauthHandlersDependencies = Pick<AuthContainer, 'oauthService'>;

/** Builds the OAuth Fastify handlers: `listOauthProviders`, `oauthRedirect` (provider authorize URL), and `oauthCallback` (state consumption + session minting). Each translates `NotImplementedError` to a typed 501 via {@link sendOauthProviderNotImplementedResponse}. */
export function createAuthOauthHandlers({ oauthService }: AuthOauthHandlersDependencies) {
  return {
    oauthRedirect: async (
      request: FastifyRequest<{ Params: { provider: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const data = await Promise.resolve().then(() =>
          oauthService.getRedirectUrl(request.params.provider),
        );
        return successResponse(data, getRequestIdentifier(request));
      } catch (error) {
        if (isOauthProviderNotImplementedError(error)) {
          return sendOauthProviderNotImplementedResponse(
            request,
            reply,
            getRequestIdentifier(request),
          );
        }
        throw error;
      }
    },
    oauthCallback: async (
      request: FastifyRequest<{
        Params: { provider: string };
        Querystring: OauthCallbackQueryInput;
      }>,
      reply: FastifyReply,
    ) => {
      const query = request.query;
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await oauthService.handleCallback(
        omitUndefined({
          provider: request.params.provider,
          code: query.code,
          state: query.state,
          ipAddress,
          userAgent,
          requestId: getRequestIdentifier(request),
        }),
      );

      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      if ('session_public_id' in data && typeof data.session_public_id === 'string') {
        setSessionCookie(reply, data.session_public_id);
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
    listOauthProviders: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = oauthService.listProviders();
      return successResponse(AuthSerializer.oauthProviders(data), getRequestIdentifier(request));
    },
  };
}
