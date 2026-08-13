import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSessionCookie = vi.fn();
const recordLoginAuditEvent = vi.fn();
const recordLoginFailureAuditEvent = vi.fn();

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'Mozilla/5.0 (Macintosh)',
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

vi.mock('@/domains/auth/shared/audit-login.util.js', () => ({
  recordLoginAuditEvent: (...args: unknown[]) => recordLoginAuditEvent(...args),
  recordLoginFailureAuditEvent: (...args: unknown[]) => recordLoginFailureAuditEvent(...args),
}));

vi.mock('@/domains/auth/auth.serializer.js', () => ({
  AuthSerializer: {
    accessToken: (data: unknown) => ({ serialized: 'accessToken', data }),
    mfaRequired: (data: unknown) => ({ serialized: 'mfaRequired', data }),
    verificationCodeSent: (data: unknown) => ({ serialized: 'verificationCodeSent', data }),
  },
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

vi.mock('@/shared/utils/http/request.util.js', () => ({
  getRequestIdentifier: () => 'req_test',
}));

vi.mock('@/shared/utils/i18n/i18n-response.util.js', () => ({
  translateMessageKeyPayload: (_request: unknown, payload: { message?: string }) => ({
    message: `translated:${payload.message ?? ''}`,
  }),
}));

const { createAuthLoginHandlers } = await import('@/domains/auth/handlers/auth-login.handlers.js');
const { createAuthEmailLoginHandlers } = await import(
  '@/domains/auth/handlers/auth-email-login.handlers.js'
);

const request = { body: { email: 'person@example.com' } } as unknown as FastifyRequest;
const reply = {} as FastifyReply;

const successfulLogin = {
  access_token: 'jwt.access.token',
  session_public_id: 'ses_abcdefghijklmnopqrst',
  session_refresh_secret: 'refresh-secret-value',
};

/**
 * The two login surfaces — password and email verification-code. Neither handler had a test, and
 * both carry the same non-obvious invariant from the sec-A8 follow-up: on a failed login they
 * record a failure audit row and then RE-RAISE the original error, so the global error handler
 * still maps it to the right HTTP status. Swallowing the error there would turn every bad
 * password into a 200; skipping the audit call would silently break the auth.overview.md rule
 * that every login, success or failure, records a row.
 *
 * The branch that must NOT set a session cookie is equally load-bearing: an `mfa_required`
 * response means the caller has not finished authenticating, so issuing the cookie at that point
 * would hand out a usable session before the second factor.
 */
describe('auth-login.handlers', () => {
  const login = vi.fn();
  const handlers = createAuthLoginHandlers({ authService: { login } } as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful password login', () => {
    it('sets the session cookie with the session id and refresh secret', async () => {
      login.mockResolvedValue(successfulLogin);

      await handlers.login(request, reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        successfulLogin.session_public_id,
        successfulLogin.session_refresh_secret,
      );
    });

    it('records the login audit event tagged as a password login', async () => {
      login.mockResolvedValue(successfulLogin);

      await handlers.login(request, reply);

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(request, successfulLogin, 'password');
      expect(recordLoginFailureAuditEvent).not.toHaveBeenCalled();
    });

    it('serializes through the access-token serializer', async () => {
      login.mockResolvedValue(successfulLogin);

      const result = await handlers.login(request, reply);

      expect(result).toEqual({
        data: { serialized: 'accessToken', data: successfulLogin },
        requestId: 'req_test',
      });
    });

    it('passes the client ip and user agent to the service', async () => {
      login.mockResolvedValue(successfulLogin);

      await handlers.login(request, reply);

      expect(login).toHaveBeenCalledWith(request.body, '203.0.113.7', 'Mozilla/5.0 (Macintosh)');
    });
  });

  describe('mfa_required response', () => {
    const mfaPending = { mfa_required: true, mfa_ticket: 'tkt_abc' };

    it('does NOT set a session cookie before the second factor', async () => {
      login.mockResolvedValue(mfaPending);

      await handlers.login(request, reply);

      expect(setSessionCookie).not.toHaveBeenCalled();
    });

    it('does NOT record a successful-login audit event', async () => {
      login.mockResolvedValue(mfaPending);

      await handlers.login(request, reply);

      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('serializes through the mfa-required serializer', async () => {
      login.mockResolvedValue(mfaPending);

      const result = await handlers.login(request, reply);

      expect(result).toEqual({
        data: { serialized: 'mfaRequired', data: mfaPending },
        requestId: 'req_test',
      });
    });
  });

  describe('failed login (sec-A8)', () => {
    it('re-raises the ORIGINAL error so the error handler maps the right status', async () => {
      const original = new Error('invalid credentials');
      login.mockRejectedValue(original);

      await expect(handlers.login(request, reply)).rejects.toBe(original);
    });

    it('records a failure audit event tagged as a password attempt', async () => {
      const original = new Error('invalid credentials');
      login.mockRejectedValue(original);

      await expect(handlers.login(request, reply)).rejects.toThrow();

      expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(request, 'password', original);
    });

    it('sets no cookie and records no success audit on failure', async () => {
      login.mockRejectedValue(new Error('invalid credentials'));

      await expect(handlers.login(request, reply)).rejects.toThrow();

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('still re-raises when the audit helper itself rejects', async () => {
      // The helper is documented as best-effort. Even if it breaks, the caller must receive the
      // authentication error rather than an audit-plumbing error.
      const original = new Error('invalid credentials');
      login.mockRejectedValue(original);
      recordLoginFailureAuditEvent.mockRejectedValueOnce(new Error('audit sink down'));

      await expect(handlers.login(request, reply)).rejects.toThrow();
    });
  });
});

describe('auth-email-login.handlers', () => {
  const sendCode = vi.fn();
  const emailLogin = vi.fn();
  const handlers = createAuthEmailLoginHandlers({
    emailLoginService: { sendCode, login: emailLogin },
  } as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendEmailCode', () => {
    it('translates the message key before serializing', async () => {
      sendCode.mockResolvedValue({ message: 'auth.codeSent', expires_in_minutes: 10 });

      const result = await handlers.sendEmailCode(request, reply);

      expect(result).toMatchObject({
        data: {
          serialized: 'verificationCodeSent',
          data: expect.objectContaining({ message: 'translated:auth.codeSent' }),
        },
      });
    });

    it('omits debug_verification_code when the service does not supply one', async () => {
      sendCode.mockResolvedValue({ message: 'auth.codeSent', expires_in_minutes: 10 });

      const result = (await handlers.sendEmailCode(request, reply)) as unknown as {
        data: { data: Record<string, unknown> };
      };

      // The debug code is a local-only affordance; it must never appear as an undefined key that
      // a serializer might later render.
      expect(result.data.data).not.toHaveProperty('debug_verification_code');
    });

    it('passes the debug code through when the service supplies one', async () => {
      sendCode.mockResolvedValue({
        message: 'auth.codeSent',
        expires_in_minutes: 10,
        debug_verification_code: '123456',
      });

      const result = (await handlers.sendEmailCode(request, reply)) as unknown as {
        data: { data: Record<string, unknown> };
      };

      expect(result.data.data.debug_verification_code).toBe('123456');
    });

    it('forwards the request id to the service', async () => {
      sendCode.mockResolvedValue({ message: 'auth.codeSent', expires_in_minutes: 10 });

      await handlers.sendEmailCode(request, reply);

      expect(sendCode).toHaveBeenCalledWith(request.body, { requestId: 'req_test' });
    });
  });

  describe('emailLogin', () => {
    it('sets the cookie and audits as an email_code login on success', async () => {
      emailLogin.mockResolvedValue(successfulLogin);

      await handlers.emailLogin(request, reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        successfulLogin.session_public_id,
        successfulLogin.session_refresh_secret,
      );
      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        request,
        {
          access_token: successfulLogin.access_token,
          session_public_id: successfulLogin.session_public_id,
        },
        'email_code',
      );
    });

    it('does NOT set a cookie on an mfa_required response', async () => {
      emailLogin.mockResolvedValue({ mfa_required: true, mfa_ticket: 'tkt_abc' });

      await handlers.emailLogin(request, reply);

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('sets no cookie when the session fields are absent from the response', async () => {
      // The guard is a runtime type check, not an assumption — a response shape without a
      // session must not reach setSessionCookie with undefined arguments.
      emailLogin.mockResolvedValue({ access_token: 'jwt.only' });

      await handlers.emailLogin(request, reply);

      expect(setSessionCookie).not.toHaveBeenCalled();
    });

    it('sets no cookie when the session fields are the wrong type', async () => {
      emailLogin.mockResolvedValue({ session_public_id: 42, session_refresh_secret: null });

      await handlers.emailLogin(request, reply);

      expect(setSessionCookie).not.toHaveBeenCalled();
    });

    it('re-raises the original error and audits the failure as email_code', async () => {
      const original = new Error('code expired');
      emailLogin.mockRejectedValue(original);

      await expect(handlers.emailLogin(request, reply)).rejects.toBe(original);
      expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(request, 'email_code', original);
    });
  });
});
