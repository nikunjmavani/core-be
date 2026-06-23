import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import {
  type LoginAuditSource,
  recordLoginAuditEvent,
  recordLoginFailureAuditEvent,
} from '@/domains/auth/shared/audit-login.util.js';
import { getIpAddress, getUserAgent, setSessionCookie } from '@/domains/auth/auth.http.util.js';
import { validateMfaMethodIdParam } from '@/domains/auth/auth.validator.js';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';

type AuthMfaHandlersDependencies = Pick<AuthContainer, 'mfaService'>;

/**
 * Best-effort discriminator for a FAILED MFA login attempt, inferred from which credential field the
 * request carried (the service threw before returning a factor). Defaults to `mfa_totp` when neither
 * field is a string, so the audit `source` is never blank.
 */
function mfaLoginSourceFromBody(body: unknown): LoginAuditSource {
  if (body !== null && typeof body === 'object' && 'recovery_code' in body) {
    const recoveryCode = (body as { recovery_code?: unknown }).recovery_code;
    if (typeof recoveryCode === 'string' && recoveryCode.length > 0) return 'mfa_recovery_code';
  }
  return 'mfa_totp';
}

/** Builds the MFA Fastify handlers: `verifyMfaLogin` (public login completion via `mfa_session_token`), `verifyMfa` (authenticated step-up), `enrollMfa`, `listMfaMethods`, and `deleteMfa`. */
export function createAuthMfaHandlers({ mfaService }: AuthMfaHandlersDependencies) {
  return {
    verifyMfaLogin: async (request: FastifyRequest, reply: FastifyReply) => {
      const ipAddress = getIpAddress(request);
      const userAgent = getUserAgent(request) ?? undefined;
      let data: Awaited<ReturnType<typeof mfaService.verifyLoginMfa>>;
      try {
        data = await mfaService.verifyLoginMfa(request.body, ipAddress, userAgent);
      } catch (error) {
        // The second factor failed/locked out — record the symmetric failure event (no actor id is
        // asserted; the failed-attempt source + IP are what an investigator queries on).
        await recordLoginFailureAuditEvent(request, mfaLoginSourceFromBody(request.body), error);
        throw error;
      }
      setSessionCookie(reply, data.session_public_id, data.session_refresh_secret);
      // The session is minted HERE (after the second factor), so this is where the login is audited.
      // The source encodes the factor; recovery-code use also emits a dedicated high-severity signal
      // (the TOTP-bypass break-glass path an incident responder must be able to find).
      const source: LoginAuditSource =
        data.factor === 'recovery_code' ? 'mfa_recovery_code' : 'mfa_totp';
      await recordLoginAuditEvent(request, data, source);
      if (data.factor === 'recovery_code') {
        await recordScopedAuditEvent(request, {
          action: 'auth.mfa.recovery_code_used',
          resource_type: 'mfa_method',
          severity: 'WARNING',
          metadata: { session_public_id: data.session_public_id },
        });
      }
      return successResponse(AuthSerializer.accessToken(data), getRequestIdentifier(request));
    },
    verifyMfa: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      let data: Awaited<ReturnType<typeof mfaService.verify>>;
      try {
        data = await mfaService.verify(auth.userId, request.body);
      } catch (error) {
        await recordScopedAuditEvent(request, {
          actorUserPublicId: auth.userId,
          action: 'auth.mfa.step_up_failure',
          resource_type: 'mfa_method',
          severity: 'INFO',
        });
        throw error;
      }
      // Step-up sentinel is per-(user, session) (sec-A2); fail closed if session id is missing.
      if (!auth.sessionPublicId) {
        throw new ForbiddenError('errors:recentStepUpRequired');
      }
      await recordRecentStepUp(redisConnection, auth.userId, auth.sessionPublicId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'auth.mfa.step_up',
        resource_type: 'mfa_method',
      });
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
      request: FastifyRequest<{ Params: { mfa_method_id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const mfaMethodId = validateMfaMethodIdParam(request.params.mfa_method_id);
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
