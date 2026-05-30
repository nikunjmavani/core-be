import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import {
  getIpAddress,
  getUserAgent,
  readRequestOrigin,
  setSessionCookie,
} from '../auth.http.util.js';
import { AuthSerializer } from '../auth.serializer.js';
import type { AuthContainer } from '../auth.container.js';

type AuthWebauthnHandlersDependencies = Pick<AuthContainer, 'webauthnService'>;

/** Builds the WebAuthn Fastify handlers: `webauthnRegisterOptions` / `webauthnRegisterVerify` for credential enrollment and `webauthnAuthenticateOptions` / `webauthnAuthenticateVerify` for passkey login (sets the session cookie on success). */
export function createAuthWebauthnHandlers({ webauthnService }: AuthWebauthnHandlersDependencies) {
  return {
    webauthnRegisterOptions: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await webauthnService.generateRegistrationOptions(
        auth.userId,
        readRequestOrigin(request),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    webauthnRegisterVerify: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await webauthnService.verifyRegistration(
        auth.userId,
        request.body,
        readRequestOrigin(request),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    webauthnAuthenticateOptions: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = await webauthnService.generateAuthenticationOptions(
        request.body,
        readRequestOrigin(request),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    webauthnAuthenticateVerify: async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await webauthnService.verifyAuthentication(
        request.body,
        getIpAddress(request),
        readRequestOrigin(request),
        getUserAgent(request) ?? undefined,
      );
      if ('mfa_required' in data && data.mfa_required === true) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }
      if ('session_public_id' in data) {
        setSessionCookie(reply, data.session_public_id);
      }
      return successResponse(
        AuthSerializer.accessToken(data as { access_token: string; session_public_id: string }),
        getRequestIdentifier(request),
      );
    },
  };
}
