import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';
import {
  getIpAddress,
  getUserAgent,
  resolveAuthMessageKeyResponse,
  setSessionCookie,
} from '@/domains/auth/auth.http.util.js';
import { recordLoginAuditEvent } from '@/domains/auth/shared/audit-login.util.js';
import {
  validateAuthMethodPublicIdParam,
  validateStepUpVerify,
} from '@/domains/auth/auth.validator.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthAuthMethodHandlersDependencies = Pick<AuthContainer, 'authMethodService' | 'authService'>;

/** Builds the auth-method management Fastify handlers (`listAuthMethods`, `createAuthMethod`, `deleteAuthMethod`, plus the password and email-verification flows) and emits the `auth.auth_method.*` audit events. Reset-password auto-logs-in via {@link AuthContainer.authService}. */
export function createAuthAuthMethodHandlers({
  authMethodService,
  authService,
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
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      const data = await authService.resetPassword(request.body, ipAddress, userAgent);

      // A completed reset is a credential change — record it DISTINCTLY (and at WARNING) from the
      // subsequent login so a reset is queryable on its own (previously it surfaced only as
      // auth.login). Recorded for both the MFA-required and auto-login branches; the adjacent login
      // event and the captured IP/UA tie it to the actor.
      await recordScopedAuditEvent(request, {
        action: 'auth.password.reset',
        resource_type: 'user',
        severity: 'WARNING',
      });

      // MFA users complete the second factor before a session is issued (the reset never bypasses MFA).
      if ('mfa_required' in data) {
        return successResponse(AuthSerializer.mfaRequired(data), getRequestIdentifier(request));
      }

      // Auto-login: the reset revoked every prior session, so this freshly-minted one is the only
      // live session — the user lands logged in instead of being bounced to the sign-in page.
      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
      // sec-A8: a reset auto-login is a login surface — audit it like password / magic-link / OAuth.
      await recordLoginAuditEvent(request, data, 'password');
      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
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
      const currentAccessToken = request.headers.authorization?.match(/^Bearer\s+(\S.*)$/i)?.[1];
      await authMethodService.changePassword(
        auth.userId,
        request.body,
        currentAccessToken ? { currentAccessToken } : undefined,
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
