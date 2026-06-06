import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import {
  clearOauthNonceCookie,
  getIpAddress,
  getUserAgent,
  isOauthProviderNotImplementedError,
  readOauthNonceCookie,
  sendOauthProviderNotImplementedResponse,
  setOauthNonceCookie,
  setSessionCookie,
} from '@/domains/auth/auth.http.util.js';
import type { OauthCallbackQueryInput } from '@/domains/auth/auth.dto.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import { recordLoginAuditEvent } from '@/domains/auth/shared/audit-login.util.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthOauthHandlersDependencies = Pick<AuthContainer, 'oauthService'>;

/** Builds the OAuth Fastify handlers: `listOauthProviders`, `oauthRedirect` (provider authorize URL), and `oauthCallback` (state consumption + session minting). Each translates `NotImplementedError` to a typed 501 via {@link sendOauthProviderNotImplementedResponse}. */
export function createAuthOauthHandlers({ oauthService }: AuthOauthHandlersDependencies) {
  return {
    oauthRedirect: async (
      request: FastifyRequest<{ Params: { provider: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { nonce, ...data } = await Promise.resolve().then(() =>
          oauthService.getRedirectUrl(request.params.provider),
        );
        // Bind the upcoming callback to this browser: the nonce is stored (hashed) with the
        // Redis state and echoed back via this httpOnly cookie so a forged state+code from a
        // different browser cannot complete the flow (login-CSRF defence).
        setOauthNonceCookie(reply, nonce);
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
      const nonce = readOauthNonceCookie(request);
      // The nonce cookie is single-use: clear it regardless of outcome so a stale value
      // cannot be replayed against a future forged state.
      clearOauthNonceCookie(reply);
      const data = await oauthService.handleCallback(
        omitUndefined({
          provider: request.params.provider,
          code: query.code,
          state: query.state,
          nonce,
          ipAddress,
          userAgent,
          requestId: getRequestIdentifier(request),
        }),
      );

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
        // sec-A8: audit OAuth success; provider is embedded in the source so an
        // incident-response query can correlate "every super_admin issued via
        // OAuth Google in the last 24h" without a separate metadata column.
        if ('access_token' in data && typeof data.access_token === 'string') {
          await recordLoginAuditEvent(
            request,
            { access_token: data.access_token, session_public_id: data.session_public_id },
            `oauth_${request.params.provider}`,
          );
        }
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
    listOauthProviders: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = oauthService.listProviders();
      return successResponse(AuthSerializer.oauthProviders(data), getRequestIdentifier(request));
    },
  };
}
