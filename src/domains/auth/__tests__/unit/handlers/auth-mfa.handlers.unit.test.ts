import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/shared/errors/index.js';

const setSessionCookie = vi.fn();
const recordLoginAuditEvent = vi.fn();
const recordLoginFailureAuditEvent = vi.fn();
const recordScopedAuditEvent = vi.fn();
const recordRecentStepUp = vi.fn();

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'Mozilla/5.0 (Macintosh)',
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

vi.mock('@/domains/auth/shared/audit-login.util.js', () => ({
  recordLoginAuditEvent: (...args: unknown[]) => recordLoginAuditEvent(...args),
  recordLoginFailureAuditEvent: (...args: unknown[]) => recordLoginFailureAuditEvent(...args),
}));

vi.mock('@/shared/utils/infrastructure/audit-request-context.util.js', () => ({
  recordScopedAuditEvent: (...args: unknown[]) => recordScopedAuditEvent(...args),
}));

vi.mock('@/shared/utils/auth/recent-step-up.util.js', () => ({
  recordRecentStepUp: (...args: unknown[]) => recordRecentStepUp(...args),
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: { __brand: 'redis' },
}));

vi.mock('@/domains/auth/auth.serializer.js', () => ({
  AuthSerializer: {
    accessToken: (data: unknown) => ({ serialized: 'accessToken', data }),
    mfaVerified: (data: unknown) => ({ serialized: 'mfaVerified', data }),
    mfaEnroll: (data: unknown) => ({ serialized: 'mfaEnroll', data }),
    mfaEnrollConfirm: (data: unknown) => ({ serialized: 'mfaEnrollConfirm', data }),
  },
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthMfaHandlers } = await import('@/domains/auth/handlers/auth-mfa.handlers.js');

const auth = {
  kind: 'user',
  userId: 'usr_abcdefghijklmnopqrst',
  sessionPublicId: 'ses_abcdefghijklmnopqrst',
};

function buildRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return { id: 'req_test', auth, body: {}, params: {}, ...overrides } as unknown as FastifyRequest;
}

function buildReply(): FastifyReply {
  const reply = {
    code: vi.fn(() => reply),
    send: vi.fn(() => reply),
  } as unknown as FastifyReply;
  return reply;
}

const loginResult = {
  access_token: 'jwt.access.token',
  session_public_id: 'ses_newnewnewnewnewnewn',
  session_refresh_secret: 'refresh-secret',
  factor: 'totp',
};

/**
 * The MFA handlers. Three invariants here are security decisions rather than plumbing.
 *
 * The first is WHERE the session is minted. `verifyMfaLogin` completes a login that
 * `POST /auth/login` deliberately left unfinished — so the cookie is issued here, after the second
 * factor, and never before it. That ordering is the entire value of MFA on this route.
 *
 * The second is sec-A2: the step-up sentinel is keyed per `(user, session)`. If the caller's token
 * carries no session id there is nothing to key on, so `verifyMfa` FAILS CLOSED with a
 * `ForbiddenError` — and crucially records no sentinel. Recording one without a session id would
 * either throw at the key layer or, worse, mint a window that any of the user's sessions could
 * spend.
 *
 * The third is the recovery-code signal. Using a recovery code bypasses TOTP by design, so it emits
 * a dedicated high-severity `auth.mfa.recovery_code_used` event on top of the ordinary login row.
 * Losing that extra event would make the one MFA-bypass path in the system look like a normal login
 * in the audit trail.
 */
describe('auth-mfa.handlers', () => {
  const mfaService = {
    verifyLoginMfa: vi.fn(),
    verify: vi.fn(),
    enrollInit: vi.fn(),
    enrollConfirm: vi.fn(),
    deleteMfa: vi.fn(),
    listMfaMethods: vi.fn(),
  };
  const handlers = createAuthMfaHandlers({ mfaService } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    mfaService.verifyLoginMfa.mockResolvedValue(loginResult);
    mfaService.verify.mockResolvedValue({ verified: true });
    mfaService.enrollInit.mockResolvedValue({ secret: 'staged' });
    mfaService.enrollConfirm.mockResolvedValue({ method_public_id: 'am_abcdefghijklmnopqrstu' });
    mfaService.listMfaMethods.mockResolvedValue([]);
  });

  describe('verifyMfaLogin — the session is minted after the second factor', () => {
    it('sets the session cookie with the new session and refresh secret', async () => {
      const reply = buildReply();

      await handlers.verifyMfaLogin(buildRequest(), reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        loginResult.session_public_id,
        loginResult.session_refresh_secret,
      );
    });

    it('passes the client ip and user agent to the service', async () => {
      const request = buildRequest({ body: { mfa_session_token: 'tkt', totp_code: '123456' } });

      await handlers.verifyMfaLogin(request, buildReply());

      expect(mfaService.verifyLoginMfa).toHaveBeenCalledWith(
        request.body,
        '203.0.113.7',
        'Mozilla/5.0 (Macintosh)',
      );
    });

    it('audits a TOTP completion as mfa_totp', async () => {
      await handlers.verifyMfaLogin(buildRequest(), buildReply());

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        loginResult,
        'mfa_totp',
      );
    });

    it('emits no recovery-code event on the ordinary TOTP path', async () => {
      await handlers.verifyMfaLogin(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
    });

    describe('recovery-code completion', () => {
      beforeEach(() => {
        mfaService.verifyLoginMfa.mockResolvedValue({ ...loginResult, factor: 'recovery_code' });
      });

      it('audits the login as mfa_recovery_code', async () => {
        await handlers.verifyMfaLogin(buildRequest(), buildReply());

        expect(recordLoginAuditEvent).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'mfa_recovery_code',
        );
      });

      it('ALSO emits a dedicated high-severity break-glass event', async () => {
        // This is the one path that bypasses TOTP. Without this second event it is
        // indistinguishable from a normal login when an incident responder queries the trail.
        await handlers.verifyMfaLogin(buildRequest(), buildReply());

        expect(recordScopedAuditEvent).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            action: 'auth.mfa.recovery_code_used',
            severity: 'WARNING',
          }),
        );
      });

      it('records the session id on the break-glass event', async () => {
        await handlers.verifyMfaLogin(buildRequest(), buildReply());

        expect(recordScopedAuditEvent).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            metadata: { session_public_id: loginResult.session_public_id },
          }),
        );
      });
    });

    describe('a failed second factor', () => {
      const failure = new Error('invalid code');

      beforeEach(() => {
        mfaService.verifyLoginMfa.mockRejectedValue(failure);
      });

      it('re-raises the ORIGINAL error so the handler maps the right status', async () => {
        await expect(handlers.verifyMfaLogin(buildRequest(), buildReply())).rejects.toBe(failure);
      });

      it('mints no session', async () => {
        await expect(handlers.verifyMfaLogin(buildRequest(), buildReply())).rejects.toThrow();

        expect(setSessionCookie).not.toHaveBeenCalled();
        expect(recordLoginAuditEvent).not.toHaveBeenCalled();
      });

      it('records the failure as mfa_totp when the body carried a TOTP code', async () => {
        const request = buildRequest({ body: { totp_code: '123456' } });

        await expect(handlers.verifyMfaLogin(request, buildReply())).rejects.toThrow();

        expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(request, 'mfa_totp', failure);
      });

      it('records the failure as mfa_recovery_code when the body carried a recovery code', async () => {
        const request = buildRequest({ body: { recovery_code: 'abcd-efgh' } });

        await expect(handlers.verifyMfaLogin(request, buildReply())).rejects.toThrow();

        expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(
          request,
          'mfa_recovery_code',
          failure,
        );
      });

      it.each([
        ['an empty recovery code', { recovery_code: '' }],
        ['a non-string recovery code', { recovery_code: 42 }],
        ['a null body', null],
        ['an empty body', {}],
      ])('falls back to mfa_totp for %s so the source is never blank', async (_label, body) => {
        const request = buildRequest({ body });

        await expect(handlers.verifyMfaLogin(request, buildReply())).rejects.toThrow();

        expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(request, 'mfa_totp', failure);
      });
    });
  });

  describe('verifyMfa — step-up (sec-A2)', () => {
    it('records the sentinel against the caller user AND session', async () => {
      await handlers.verifyMfa(buildRequest(), buildReply());

      expect(recordRecentStepUp).toHaveBeenCalledWith(
        { __brand: 'redis' },
        auth.userId,
        auth.sessionPublicId,
        'mfa',
      );
    });

    it('audits the successful step-up', async () => {
      await handlers.verifyMfa(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.mfa.step_up' }),
      );
    });

    it('fails closed when the token carries no session id', async () => {
      // There is nothing to key the per-session sentinel on, so the only safe answer is refusal.
      const request = buildRequest({ auth: { ...auth, sessionPublicId: undefined } });

      await expect(handlers.verifyMfa(request, buildReply())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('records NO sentinel when it fails closed', async () => {
      // The sharp edge: recording a window with no session id would mint one that any of the
      // user's sessions could spend.
      const request = buildRequest({ auth: { ...auth, sessionPublicId: undefined } });

      await expect(handlers.verifyMfa(request, buildReply())).rejects.toThrow();

      expect(recordRecentStepUp).not.toHaveBeenCalled();
    });

    it('audits a failed step-up and re-raises', async () => {
      const failure = new Error('invalid code');
      mfaService.verify.mockRejectedValue(failure);

      await expect(handlers.verifyMfa(buildRequest(), buildReply())).rejects.toBe(failure);
      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.mfa.step_up_failure' }),
      );
    });

    it('records no sentinel when the factor itself failed', async () => {
      mfaService.verify.mockRejectedValue(new Error('invalid code'));

      await expect(handlers.verifyMfa(buildRequest(), buildReply())).rejects.toThrow();

      expect(recordRecentStepUp).not.toHaveBeenCalled();
    });
  });

  describe('enrollment', () => {
    it('audits the init phase without a method id (nothing is persisted yet)', async () => {
      await handlers.enrollMfa(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.mfa.enroll_init' }),
      );
      expect(recordScopedAuditEvent.mock.calls[0]?.[1]).not.toHaveProperty('metadata');
    });

    it('audits the confirm phase WITH the persisted method id', async () => {
      await handlers.confirmEnrollMfa(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.mfa.enroll_confirm',
          metadata: { mfa_method_id: 'am_abcdefghijklmnopqrstu' },
        }),
      );
    });

    it('scopes enrollment to the authenticated user', async () => {
      await handlers.enrollMfa(buildRequest({ body: { method_type: 'MFA_TOTP' } }), buildReply());

      expect(mfaService.enrollInit).toHaveBeenCalledWith(auth.userId, { method_type: 'MFA_TOTP' });
    });
  });

  describe('deleteMfa', () => {
    const params = { mfa_method_id: 'am_abcdefghijklmnopqrstu' };

    it('deletes the validated method for the authenticated user', async () => {
      await handlers.deleteMfa(buildRequest({ params }) as never, buildReply());

      expect(mfaService.deleteMfa).toHaveBeenCalledWith(auth.userId, params.mfa_method_id);
    });

    it('answers 204', async () => {
      const reply = buildReply();

      await handlers.deleteMfa(buildRequest({ params }) as never, reply);

      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it('rejects a malformed method id before touching the service', async () => {
      // The param is an opaque `am_` public id (route-#10) — a sequential row id must not resolve.
      const request = buildRequest({ params: { mfa_method_id: '42' } });

      await expect(handlers.deleteMfa(request as never, buildReply())).rejects.toThrow();
      expect(mfaService.deleteMfa).not.toHaveBeenCalled();
    });

    it('audits the deletion with the method id', async () => {
      await handlers.deleteMfa(buildRequest({ params }) as never, buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.mfa.delete',
          metadata: { mfa_method_id: params.mfa_method_id },
        }),
      );
    });
  });

  describe('listMfaMethods', () => {
    it('lists only the authenticated user methods', async () => {
      await handlers.listMfaMethods(buildRequest(), buildReply());

      expect(mfaService.listMfaMethods).toHaveBeenCalledWith(auth.userId);
    });

    it('wraps the result in a success envelope', async () => {
      mfaService.listMfaMethods.mockResolvedValue([{ id: 'am_1' }]);

      const result = await handlers.listMfaMethods(buildRequest(), buildReply());

      expect(result).toEqual({ data: [{ id: 'am_1' }], requestId: 'req_test' });
    });
  });
});
