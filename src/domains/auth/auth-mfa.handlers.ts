import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from './auth.http.util.js';
import { validateMfaMethodIdParam } from './auth.validator.js';
import { AuthSerializer } from './auth.serializer.js';
import type { AuthContainer } from './auth.container.js';

type AuthMfaHandlersDependencies = Pick<AuthContainer, 'mfaService'>;

export function createAuthMfaHandlers({ mfaService }: AuthMfaHandlersDependencies) {
  return {
    verifyMfa: async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | undefined;
      if (body !== undefined && typeof body.mfa_session_token === 'string') {
        const ipAddress = getIpAddress(request);
        const userAgent = getUserAgent(request) ?? undefined;
        const data = await mfaService.verifyLoginMfa(request.body, ipAddress, userAgent);
        setSessionCookie(reply, data.session_public_id);
        return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
      }
      const auth = requireAuth(request);
      const data = await mfaService.verify(auth.userId, request.body);
      return successResponse(AuthSerializer.mfaVerified(data), getRequestIdentifier(request));
    },
    enrollMfa: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await mfaService.enroll(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.mfa.enroll',
        resource_type: 'mfa_method',
      });
      return successResponse(AuthSerializer.mfaEnroll(data), getRequestIdentifier(request));
    },
    challengeMfa: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await mfaService.challenge(request.body, ipAddress, userAgent);

      if ('session_public_id' in data && typeof data.session_public_id === 'string') {
        setSessionCookie(reply, data.session_public_id);
      }

      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
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
