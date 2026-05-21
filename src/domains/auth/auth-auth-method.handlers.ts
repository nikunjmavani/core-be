import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { resolveAuthMessageKeyResponse } from './auth.http.util.js';
import { validateAuthMethodIdParam } from './auth.validator.js';
import { AuthSerializer } from './auth.serializer.js';
import type { AuthContainer } from './auth.container.js';

type AuthAuthMethodHandlersDependencies = Pick<AuthContainer, 'authMethodService'>;

export function createAuthAuthMethodHandlers({
  authMethodService,
}: AuthAuthMethodHandlersDependencies) {
  return {
    listAuthMethods: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authMethodService.list(auth.userId);
      return successResponse(AuthSerializer.authMethodList(data), getRequestIdentifier(request));
    },
    createAuthMethod: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authMethodService.create(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.auth_method.create',
        resource_type: 'auth_method',
        metadata: { auth_method_id: (data as { id?: number }).id },
      });
      return successResponse(AuthSerializer.authMethod(data), getRequestIdentifier(request));
    },
    deleteAuthMethod: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const identifier = validateAuthMethodIdParam(request.params.id);
      await authMethodService.delete(auth.userId, identifier);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.auth_method.delete',
        resource_type: 'auth_method',
        metadata: { auth_method_id: identifier },
      });
      return reply.code(204).send();
    },
    forgotPassword: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = await authMethodService.forgotPassword(request.body, {
        requestId: getRequestIdentifier(request),
      });
      return successResponse(
        resolveAuthMessageKeyResponse(request, data),
        getRequestIdentifier(request),
      );
    },
    resetPassword: async (request: FastifyRequest, reply: FastifyReply) => {
      await authMethodService.resetPassword(request.body);
      return reply.code(204).send();
    },
    changePassword: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      await authMethodService.changePassword(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.password.change',
        resource_type: 'user',
      });
      return reply.code(204).send();
    },
    verifyEmail: async (request: FastifyRequest, _reply: FastifyReply) => {
      const data = await authMethodService.verifyEmail(request.body);
      return successResponse(
        resolveAuthMessageKeyResponse(request, data),
        getRequestIdentifier(request),
      );
    },
    resendEmailVerification: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authMethodService.resendEmailVerification(auth.userId, {
        requestId: getRequestIdentifier(request),
      });
      return successResponse(
        resolveAuthMessageKeyResponse(request, data),
        getRequestIdentifier(request),
      );
    },
  };
}
