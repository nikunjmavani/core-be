import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/shared/errors/index.js';

const setSessionCookie = vi.fn();
const recordLoginAuditEvent = vi.fn();
const recordScopedAuditEvent = vi.fn();
const recordRecentStepUp = vi.fn();

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'Mozilla/5.0 (Macintosh)',
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
  resolveAuthMessageKeyResponse: (_request: unknown, data: unknown) => ({ resolved: data }),
}));

vi.mock('@/domains/auth/shared/audit-login.util.js', () => ({
  recordLoginAuditEvent: (...args: unknown[]) => recordLoginAuditEvent(...args),
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
    mfaRequired: (data: unknown) => ({ serialized: 'mfaRequired', data }),
    authMethod: (data: unknown) => ({ serialized: 'authMethod', data }),
    authMethodList: (data: unknown) => ({ serialized: 'authMethodList', data }),
  },
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthAuthMethodHandlers } = await import(
  '@/domains/auth/handlers/auth-auth-method.handlers.js'
);

const auth = {
  kind: 'user',
  userId: 'usr_abcdefghijklmnopqrst',
  sessionPublicId: 'ses_abcdefghijklmnopqrst',
};

function buildRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    id: 'req_test',
    auth,
    body: {},
    params: {},
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function buildReply(): FastifyReply {
  const reply = {
    code: vi.fn(() => reply),
    send: vi.fn(() => reply),
  } as unknown as FastifyReply;
  return reply;
}

const resetResult = {
  access_token: 'jwt.access.token',
  session_public_id: 'ses_newnewnewnewnewnewn',
  session_refresh_secret: 'refresh-secret',
};

/**
 * The credential-management handlers. Three behaviours here are load-bearing.
 *
 * `resetPassword` records `auth.password.reset` at WARNING *distinctly* from the login that follows
 * it. Before that split, a completed reset surfaced only as an `auth.login` row — so "was this
 * account's password reset?" was not a queryable question. The event fires on BOTH branches
 * (MFA-required and auto-login), because the credential changed either way.
 *
 * The reset must also never bypass MFA. When the service reports `mfa_required`, no cookie is set:
 * the user finishes the second factor before any session exists.
 *
 * `stepUp` tags the resulting window with the factor that earned it. The `email_code` factor is
 * bootstrap-only — it can enroll a first factor but must never satisfy the strong gate on
 * destructive mutations — so mislabelling it as `password` would silently upgrade the weakest
 * re-authentication path into the strongest. Like the MFA step-up, it fails closed (and records
 * nothing) when the token carries no session id (sec-A2).
 */
describe('auth-auth-method.handlers', () => {
  const authMethodService = {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    forgotPassword: vi.fn(),
    verifyPasswordForStepUp: vi.fn(),
    changePassword: vi.fn(),
  };
  const authService = { resetPassword: vi.fn() };
  const emailLoginService = { verifyCodeForStepUp: vi.fn() };
  const handlers = createAuthAuthMethodHandlers({
    authMethodService,
    authService,
    emailLoginService,
  } as never);

  beforeEach(() => {
    // Implementations are re-seeded (not just cleared): `mockRejectedValue` survives
    // `clearAllMocks`, so a failure case in one test would otherwise leak into the next.
    vi.clearAllMocks();
    authMethodService.list.mockResolvedValue([]);
    authMethodService.create.mockResolvedValue({ public_id: 'am_abcdefghijklmnopqrstu' });
    authMethodService.delete.mockResolvedValue(undefined);
    authMethodService.forgotPassword.mockResolvedValue({ message: 'auth.resetSent' });
    authMethodService.verifyPasswordForStepUp.mockResolvedValue(undefined);
    authMethodService.changePassword.mockResolvedValue(undefined);
    emailLoginService.verifyCodeForStepUp.mockResolvedValue(undefined);
    authService.resetPassword.mockResolvedValue(resetResult);
  });

  describe('resetPassword', () => {
    it('records the credential change as a distinct WARNING event', async () => {
      await handlers.resetPassword(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.password.reset', severity: 'WARNING' }),
      );
    });

    it('records that event on the MFA-required branch too', async () => {
      // The password changed whether or not a session was issued — the reset is auditable on its
      // own terms, not as a side effect of the login that may not happen.
      authService.resetPassword.mockResolvedValue({ mfa_required: true, mfa_ticket: 'tkt' });

      await handlers.resetPassword(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.password.reset' }),
      );
    });

    it('does NOT mint a session when MFA is still outstanding', async () => {
      // A reset must never be a way around the second factor.
      authService.resetPassword.mockResolvedValue({ mfa_required: true, mfa_ticket: 'tkt' });

      await handlers.resetPassword(buildRequest(), buildReply());

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('serializes the MFA branch through the mfa-required serializer', async () => {
      const pending = { mfa_required: true, mfa_ticket: 'tkt' };
      authService.resetPassword.mockResolvedValue(pending);

      const result = await handlers.resetPassword(buildRequest(), buildReply());

      expect(result).toEqual({
        data: { serialized: 'mfaRequired', data: pending },
        requestId: 'req_test',
      });
    });

    it('auto-logs the user in when no second factor is pending', async () => {
      const reply = buildReply();

      await handlers.resetPassword(buildRequest(), reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        resetResult.session_public_id,
        resetResult.session_refresh_secret,
      );
    });

    it('audits the auto-login as a login surface (sec-A8)', async () => {
      await handlers.resetPassword(buildRequest(), buildReply());

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        resetResult,
        'password',
      );
    });

    it('passes the client ip and user agent to the service', async () => {
      const request = buildRequest({ body: { token: 'tok', password: 'Password!234' } });

      await handlers.resetPassword(request, buildReply());

      expect(authService.resetPassword).toHaveBeenCalledWith(
        request.body,
        '203.0.113.7',
        'Mozilla/5.0 (Macintosh)',
      );
    });

    it('records nothing when the reset itself fails', async () => {
      authService.resetPassword.mockRejectedValue(new Error('token expired'));

      await expect(handlers.resetPassword(buildRequest(), buildReply())).rejects.toThrow();

      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
      expect(setSessionCookie).not.toHaveBeenCalled();
    });
  });

  describe('stepUp', () => {
    it('tags a password step-up with the password factor', async () => {
      await handlers.stepUp(buildRequest({ body: { password: 'correct horse' } }), buildReply());

      expect(recordRecentStepUp).toHaveBeenCalledWith(
        { __brand: 'redis' },
        auth.userId,
        auth.sessionPublicId,
        'password',
      );
    });

    it('tags a code step-up with the email_code factor, never password', async () => {
      // email_code is bootstrap-only: it may enroll a first factor but must never satisfy the
      // strong gate. Mislabelling it here would silently promote the weakest path to the strongest.
      await handlers.stepUp(buildRequest({ body: { code: 'A1B2C3' } }), buildReply());

      expect(recordRecentStepUp).toHaveBeenCalledWith(
        { __brand: 'redis' },
        auth.userId,
        auth.sessionPublicId,
        'email_code',
      );
    });

    it('verifies the password against the authenticated user', async () => {
      await handlers.stepUp(buildRequest({ body: { password: 'correct horse' } }), buildReply());

      expect(authMethodService.verifyPasswordForStepUp).toHaveBeenCalledWith({
        userPublicId: auth.userId,
        password: 'correct horse',
      });
      expect(emailLoginService.verifyCodeForStepUp).not.toHaveBeenCalled();
    });

    it('verifies the code against the authenticated user', async () => {
      await handlers.stepUp(buildRequest({ body: { code: 'A1B2C3' } }), buildReply());

      expect(emailLoginService.verifyCodeForStepUp).toHaveBeenCalledWith({
        userPublicId: auth.userId,
        code: 'A1B2C3',
      });
      expect(authMethodService.verifyPasswordForStepUp).not.toHaveBeenCalled();
    });

    it('records the factor on the audit event', async () => {
      await handlers.stepUp(buildRequest({ body: { code: 'A1B2C3' } }), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.step_up', metadata: { factor: 'email_code' } }),
      );
    });

    it('fails closed when the token carries no session id (sec-A2)', async () => {
      const request = buildRequest({
        auth: { ...auth, sessionPublicId: undefined },
        body: { password: 'correct horse' },
      });

      await expect(handlers.stepUp(request, buildReply())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('records NO sentinel when it fails closed', async () => {
      const request = buildRequest({
        auth: { ...auth, sessionPublicId: undefined },
        body: { password: 'correct horse' },
      });

      await expect(handlers.stepUp(request, buildReply())).rejects.toThrow();

      expect(recordRecentStepUp).not.toHaveBeenCalled();
    });

    it('records no sentinel when the factor verification fails', async () => {
      authMethodService.verifyPasswordForStepUp.mockRejectedValue(new Error('wrong password'));

      await expect(
        handlers.stepUp(buildRequest({ body: { password: 'wrong' } }), buildReply()),
      ).rejects.toThrow();

      expect(recordRecentStepUp).not.toHaveBeenCalled();
      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
    });

    it('rejects a body carrying BOTH factors before verifying either', async () => {
      const request = buildRequest({ body: { password: 'p', code: 'A1B2C3' } });

      await expect(handlers.stepUp(request, buildReply())).rejects.toThrow();
      expect(authMethodService.verifyPasswordForStepUp).not.toHaveBeenCalled();
      expect(emailLoginService.verifyCodeForStepUp).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      await expect(handlers.stepUp(buildRequest({ body: {} }), buildReply())).rejects.toThrow();
    });

    it('reports success only after the sentinel is recorded', async () => {
      const result = await handlers.stepUp(
        buildRequest({ body: { password: 'correct horse' } }),
        buildReply(),
      );

      expect(result).toEqual({ data: { stepped_up: true }, requestId: 'req_test' });
      expect(recordRecentStepUp).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword', () => {
    it('forwards the caller current token so their own session survives', async () => {
      const request = buildRequest({ headers: { authorization: 'Bearer jwt.access.token' } });

      await handlers.changePassword(request, buildReply());

      expect(authMethodService.changePassword).toHaveBeenCalledWith(auth.userId, request.body, {
        currentAccessToken: 'jwt.access.token',
      });
    });

    it('accepts a lowercase bearer scheme', async () => {
      const request = buildRequest({ headers: { authorization: 'bearer jwt.access.token' } });

      await handlers.changePassword(request, buildReply());

      expect(authMethodService.changePassword).toHaveBeenCalledWith(auth.userId, request.body, {
        currentAccessToken: 'jwt.access.token',
      });
    });

    it.each([
      ['a missing header', {}],
      ['a non-bearer scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
      ['a bearer with no token', { authorization: 'Bearer ' }],
    ])('passes undefined options for %s', async (_label, headers) => {
      // The options object is omitted rather than passed with an empty token — an empty string
      // would be compared against real session tokens.
      await handlers.changePassword(buildRequest({ headers }), buildReply());

      expect(authMethodService.changePassword).toHaveBeenCalledWith(
        auth.userId,
        expect.anything(),
        undefined,
      );
    });

    it('audits the change and answers 204', async () => {
      const reply = buildReply();

      await handlers.changePassword(buildRequest(), reply);

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.password.change' }),
      );
      expect(reply.code).toHaveBeenCalledWith(204);
    });
  });

  describe('auth-method CRUD', () => {
    it('lists only the authenticated user methods', async () => {
      await handlers.listAuthMethods(buildRequest(), buildReply());

      expect(authMethodService.list).toHaveBeenCalledWith(auth.userId);
    });

    it('answers 201 on create', async () => {
      const reply = buildReply();

      await handlers.createAuthMethod(buildRequest(), reply);

      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it('audits the created method id', async () => {
      await handlers.createAuthMethod(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.auth_method.create',
          metadata: { auth_method_id: 'am_abcdefghijklmnopqrstu' },
        }),
      );
    });

    it('deletes the validated method for the authenticated user', async () => {
      const request = buildRequest({ params: { auth_method_id: 'am_abcdefghijklmnopqrstu' } });

      await handlers.deleteAuthMethod(request as never, buildReply());

      expect(authMethodService.delete).toHaveBeenCalledWith(
        auth.userId,
        'am_abcdefghijklmnopqrstu',
      );
    });

    it('rejects a malformed method id before touching the service', async () => {
      // sec-new-B4: the param is an opaque public id, not the sequential row id.
      const request = buildRequest({ params: { auth_method_id: '42' } });

      await expect(handlers.deleteAuthMethod(request as never, buildReply())).rejects.toThrow();
      expect(authMethodService.delete).not.toHaveBeenCalled();
    });

    it('answers 204 on delete', async () => {
      const reply = buildReply();
      const request = buildRequest({ params: { auth_method_id: 'am_abcdefghijklmnopqrstu' } });

      await handlers.deleteAuthMethod(request as never, reply);

      expect(reply.code).toHaveBeenCalledWith(204);
    });
  });

  describe('forgotPassword', () => {
    it('resolves the message key rather than leaking a raw key', async () => {
      const result = await handlers.forgotPassword(buildRequest(), buildReply());

      expect(result).toEqual({
        data: { resolved: { message: 'auth.resetSent' } },
        requestId: 'req_test',
      });
    });

    it('forwards the request id to the service', async () => {
      const request = buildRequest({ body: { email: 'person@example.com' } });

      await handlers.forgotPassword(request, buildReply());

      expect(authMethodService.forgotPassword).toHaveBeenCalledWith(request.body, {
        requestId: 'req_test',
      });
    });

    it('records no audit event (the response is deliberately uniform)', async () => {
      // forgot-password answers identically for known and unknown addresses; an audit row keyed to
      // an actor here would be an enumeration oracle by another name.
      await handlers.forgotPassword(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
    });
  });
});
