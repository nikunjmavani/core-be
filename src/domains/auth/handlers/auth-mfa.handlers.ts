import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { validateMfaMethodIdParam } from '@/domains/auth/auth.validator.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthMfaHandlersDependencies = Pick<AuthContainer, 'mfaService'>;

/** Builds the MFA Fastify handlers: `verifyMfaLogin` (public login completion via `mfa_session_token`), `verifyMfa` (authenticated step-up), `enrollMfa`, `listMfaMethods`, and `deleteMfa`. */
export function createAuthMfaHandlers({ mfaService }: AuthMfaHandlersDependencies) {
  return {
    verifyMfaLogin: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await mfaService.verifyLoginMfa(request.body, ipAddress, userAgent);
      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
    verifyMfa: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await mfaService.verify(auth.userId, request.body);
      // Step-up sentinel is per-(user, session) (sec-A2); fail closed if session id is missing.
      if (!auth.sessionPublicId) {
        throw new ForbiddenError('errors:recentStepUpRequired');
      }
      await recordRecentStepUp(redisConnection, auth.userId, auth.sessionPublicId);
      return successResponse(AuthSerializer.mfaVerified(data), getRequestIdentifier(request));
    },
    enrollMfa: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await mfaService.enrollInit(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.mfa.enroll_init',
        resource_type: 'mfa_method',
      });
      return successResponse(AuthSerializer.mfaEnroll(data), getRequestIdentifier(request));
    },
    confirmEnrollMfa: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await mfaService.enrollConfirm(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.mfa.enroll_confirm',
        resource_type: 'mfa_method',
        metadata: { mfa_method_id: data.method_public_id },
      });
      return successResponse(AuthSerializer.mfaEnrollConfirm(data), getRequestIdentifier(request));
    },
    deleteMfa: async (
      request: FastifyRequest<{ Params: { mfaMethodId: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const mfaMethodId = validateMfaMethodIdParam(request.params.mfaMethodId);
      await mfaService.deleteMfa(auth.userId, mfaMethodId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.mfa.delete',
        resource_type: 'mfa_method',
        metadata: { mfa_method_id: mfaMethodId },
      });
      return reply.code(204).send();
    },
    listMfaMethods: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await mfaService.listMfaMethods(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
  };
}
