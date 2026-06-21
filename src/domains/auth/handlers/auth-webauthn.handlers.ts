import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import {
  getIpAddress,
  getUserAgent,
  readRequestOrigin,
  setSessionCookie,
} from '@/domains/auth/auth.http.util.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import { validateWebauthnCredentialIdParam } from '@/domains/auth/sub-domains/auth-webauthn/webauthn.validator.js';
import {
  recordLoginAuditEvent,
  recordLoginFailureAuditEvent,
} from '@/domains/auth/shared/audit-login.util.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthWebauthnHandlersDependencies = Pick<AuthContainer, 'webauthnService'>;

/** Builds the WebAuthn Fastify handlers: `webauthnRegisterOptions` / `webauthnRegisterVerify` for credential enrollment, `webauthnAuthenticateOptions` / `webauthnAuthenticateVerify` for passkey login (sets the session cookie on success), and `webauthnListCredentials` / `webauthnRevokeCredential` for owner-scoped passkey management. */
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
    webauthnListCredentials: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await webauthnService.listCredentials(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    webauthnRevokeCredential: async (
      request: FastifyRequest<{ Params: { credential_id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const credentialPublicId = validateWebauthnCredentialIdParam(request.params.credential_id);
      await webauthnService.revokeCredential(auth.userId, credentialPublicId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.webauthn.revoke',
        resource_type: 'webauthn_credential',
        metadata: { credential_id: credentialPublicId },
      });
      return reply.code(204).send();
    },
    webauthnAuthenticateOptions: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = await webauthnService.generateAuthenticationOptions(
        request.body,
        readRequestOrigin(request),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    webauthnAuthenticateVerify: async (request: FastifyRequest, reply: FastifyReply) => {
      let data: Awaited<ReturnType<typeof webauthnService.verifyAuthentication>>;
      try {
        data = await webauthnService.verifyAuthentication(
          request.body,
          getIpAddress(request),
          readRequestOrigin(request),
          getUserAgent(request) ?? undefined,
        );
      } catch (error) {
        // sec-A8 follow-up: record the failure side of the auth.overview.md invariant.
        await recordLoginFailureAuditEvent(request, 'webauthn', error);
        throw error;
      }
      if ('mfa_required' in data && data.mfa_required === true) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }
      if (
        'session_public_id' in data &&
        'session_refresh_secret' in data &&
        typeof data.session_public_id === 'string' &&
        typeof data.session_refresh_secret === 'string'
      ) {
        setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
        // sec-A8: audit WebAuthn passkey login so the auth.overview.md "every login
        // records a row" invariant holds across every entrypoint.
        if ('access_token' in data && typeof data.access_token === 'string') {
          await recordLoginAuditEvent(
            request,
            { access_token: data.access_token, session_public_id: data.session_public_id },
            'webauthn',
          );
        }
      }
      return successResponse(
        AuthSerializer.accessToken(data as { access_token: string; session_public_id?: string }),
        getRequestIdentifier(request),
      );
    },
  };
}
