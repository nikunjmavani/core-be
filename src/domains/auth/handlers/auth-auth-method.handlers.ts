import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';
import { resolveAuthMessageKeyResponse } from '@/domains/auth/auth.http.util.js';
import {
  validateAuthMethodPublicIdParam,
  validateStepUpVerify,
} from '@/domains/auth/auth.validator.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthAuthMethodHandlersDependencies = Pick<AuthContainer, 'authMethodService'>;

/** Builds the auth-method management Fastify handlers (`listAuthMethods`, `createAuthMethod`, `deleteAuthMethod`, plus the password and email-verification flows) and emits the `auth.auth_method.*` audit events. */
export function createAuthAuthMethodHandlers({
  authMethodService,
}: AuthAuthMethodHandlersDependencies) {
  return {
    listAuthMethods: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authMethodService.list(auth.userId);
      return successResponse(AuthSerializer.authMethodList(data), getRequestIdentifier(request));
    },
    createAuthMethod: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await authMethodService.create(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.auth_method.create',
        resource_type: 'auth_method',
        metadata: { auth_method_id: (data as { public_id?: string }).public_id },
      });
      reply.code(201);
      return successResponse(AuthSerializer.authMethod(data), getRequestIdentifier(request));
    },
    deleteAuthMethod: async (
      request: FastifyRequest<{ Params: { auth_method_id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const publicId = validateAuthMethodPublicIdParam(request.params.auth_method_id);
      await authMethodService.delete(auth.userId, publicId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.auth_method.delete',
        resource_type: 'auth_method',
        metadata: { auth_method_id: publicId },
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
    stepUp: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { password } = validateStepUpVerify(request.body);
      await authMethodService.verifyPasswordForStepUp({ userPublicId: auth.userId, password });
      // Step-up sentinel is per-(user, session) (sec-A2); fail closed if session id is missing.
      if (!auth.sessionPublicId) {
        throw new ForbiddenError('errors:recentStepUpRequired');
      }
      await recordRecentStepUp(redisConnection, auth.userId, auth.sessionPublicId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.step_up',
        resource_type: 'user',
      });
      return successResponse({ stepped_up: true }, getRequestIdentifier(request));
    },
    changePassword: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      // Exclude the caller's own session from the family-wide revoke by its stable public id
      // (not the rotatable access-token hash) so a concurrent refresh cannot evict it.
      const currentSessionPublicId = auth.sessionPublicId;
      await authMethodService.changePassword(
        auth.userId,
        request.body,
        currentSessionPublicId ? { currentSessionPublicId } : undefined,
      );
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
