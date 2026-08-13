import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSessionCookie = vi.fn();
const setOauthNonceCookie = vi.fn();
const clearOauthNonceCookie = vi.fn();
const readOauthNonceCookie = vi.fn();
const recordLoginAuditEvent = vi.fn();
const recordLoginFailureAuditEvent = vi.fn();
const sendOauthProviderNotImplementedResponse = vi.fn(() => ({ notImplemented: true }));

class NotImplemented extends Error {}

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'Mozilla/5.0 (Macintosh)',
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
  setOauthNonceCookie: (...args: unknown[]) => setOauthNonceCookie(...args),
  clearOauthNonceCookie: (...args: unknown[]) => clearOauthNonceCookie(...args),
  readOauthNonceCookie: (...args: unknown[]) => readOauthNonceCookie(...args),
  isOauthProviderNotImplementedError: (error: unknown) => error instanceof NotImplemented,
  sendOauthProviderNotImplementedResponse: (...args: unknown[]) =>
    sendOauthProviderNotImplementedResponse(...(args as [])),
}));

vi.mock('@/domains/auth/shared/audit-login.util.js', () => ({
  recordLoginAuditEvent: (...args: unknown[]) => recordLoginAuditEvent(...args),
  recordLoginFailureAuditEvent: (...args: unknown[]) => recordLoginFailureAuditEvent(...args),
}));

vi.mock('@/domains/auth/auth.serializer.js', () => ({
  AuthSerializer: {
    accessToken: (data: unknown) => ({ serialized: 'accessToken', data }),
    mfaRequired: (data: unknown) => ({ serialized: 'mfaRequired', data }),
    oauthProviders: (data: unknown) => ({ serialized: 'oauthProviders', data }),
  },
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthOauthHandlers } = await import('@/domains/auth/handlers/auth-oauth.handlers.js');

function buildRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    id: 'req_test',
    params: { provider: 'google' },
    query: { code: 'auth-code', state: 'opaque-state' },
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

const callbackResult = {
  access_token: 'jwt.access.token',
  session_public_id: 'ses_abcdefghijklmnopqrst',
  session_refresh_secret: 'refresh-secret',
};

/**
 * The OAuth handlers. Two of these behaviours are login-CSRF defences and one is an audit
 * invariant, and all three are invisible from the shape of the code.
 *
 * The nonce is what binds a callback to the browser that started the flow. `oauthRedirect` sets it
 * as an httpOnly cookie alongside the (hashed) Redis state, and `oauthCallback` reads it back and
 * forwards it to the service. Without that pairing, a forged `state`+`code` captured from another
 * browser would complete the flow and mint a session for the attacker's account in the victim's
 * browser.
 *
 * The nonce is also SINGLE-USE: the callback clears the cookie **before** the service call, so it
 * is gone whether the exchange succeeds, fails, or throws. Clearing it only on the success path
 * would leave a live nonce available for replay against a future forged state — which is exactly
 * the case the "clears it even when the exchange throws" test below pins.
 *
 * The audit source embeds the provider (`oauth_google`, not a bare `oauth`) on BOTH the success and
 * failure sides, so incident response can ask "every Google-OAuth failure in the last hour" without
 * a separate metadata column.
 */
describe('auth-oauth.handlers', () => {
  const oauthService = {
    getRedirectUrl: vi.fn(),
    handleCallback: vi.fn(),
    listProviders: vi.fn(),
  };
  const handlers = createAuthOauthHandlers({ oauthService } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    oauthService.getRedirectUrl.mockReturnValue({
      nonce: 'nonce-value',
      authorization_url: 'https://accounts.google.com/o/oauth2/auth?x=1',
    });
    oauthService.handleCallback.mockResolvedValue(callbackResult);
    oauthService.listProviders.mockReturnValue(['google']);
    readOauthNonceCookie.mockReturnValue('nonce-value');
  });

  describe('oauthRedirect', () => {
    it('sets the nonce cookie that binds the callback to this browser', async () => {
      const reply = buildReply();

      await handlers.oauthRedirect(buildRequest() as never, reply);

      expect(setOauthNonceCookie).toHaveBeenCalledWith(reply, 'nonce-value');
    });

    it('does NOT leak the nonce in the response body', async () => {
      // The nonce is a browser-binding secret. Returning it would let a caller reproduce it in a
      // different browser and defeat the binding entirely.
      const result = (await handlers.oauthRedirect(buildRequest() as never, buildReply())) as {
        data: Record<string, unknown>;
      };

      expect(result.data).not.toHaveProperty('nonce');
      expect(result.data.authorization_url).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    });

    it('asks the service for the requested provider', async () => {
      await handlers.oauthRedirect(
        buildRequest({ params: { provider: 'github' } }) as never,
        buildReply(),
      );

      expect(oauthService.getRedirectUrl).toHaveBeenCalledWith('github');
    });

    it('answers a typed 501 for an unimplemented provider', async () => {
      oauthService.getRedirectUrl.mockImplementation(() => {
        throw new NotImplemented('no such provider');
      });

      const result = await handlers.oauthRedirect(buildRequest() as never, buildReply());

      expect(sendOauthProviderNotImplementedResponse).toHaveBeenCalled();
      expect(result).toEqual({ notImplemented: true });
    });

    it('sets no nonce cookie for an unimplemented provider', async () => {
      oauthService.getRedirectUrl.mockImplementation(() => {
        throw new NotImplemented('no such provider');
      });

      await handlers.oauthRedirect(buildRequest() as never, buildReply());

      expect(setOauthNonceCookie).not.toHaveBeenCalled();
    });

    it('re-raises any other error rather than masking it as a 501', async () => {
      const failure = new Error('provider config missing');
      oauthService.getRedirectUrl.mockImplementation(() => {
        throw failure;
      });

      await expect(handlers.oauthRedirect(buildRequest() as never, buildReply())).rejects.toBe(
        failure,
      );
      expect(sendOauthProviderNotImplementedResponse).not.toHaveBeenCalled();
    });
  });

  describe('oauthCallback — nonce handling', () => {
    it('forwards the nonce read from the cookie to the service', async () => {
      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(oauthService.handleCallback).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: 'nonce-value' }),
      );
    });

    it('clears the nonce cookie on the success path', async () => {
      const reply = buildReply();

      await handlers.oauthCallback(buildRequest() as never, reply);

      expect(clearOauthNonceCookie).toHaveBeenCalledWith(reply);
    });

    it('clears the nonce cookie even when the exchange THROWS', async () => {
      // Single-use means single-use. A nonce left alive after a failed exchange is a nonce
      // available for replay against a future forged state.
      oauthService.handleCallback.mockRejectedValue(new Error('state mismatch'));
      const reply = buildReply();

      await expect(handlers.oauthCallback(buildRequest() as never, reply)).rejects.toThrow();

      expect(clearOauthNonceCookie).toHaveBeenCalledWith(reply);
    });

    it('omits the nonce key entirely when the cookie is absent', async () => {
      // omitUndefined keeps `nonce: undefined` out of the payload, so the service sees a missing
      // nonce rather than an explicit undefined that a loose check might treat as "provided".
      readOauthNonceCookie.mockReturnValue(undefined);

      await handlers.oauthCallback(buildRequest() as never, buildReply());

      const payload = oauthService.handleCallback.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('nonce');
    });

    it('forwards the provider, code, state, ip and user agent', async () => {
      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(oauthService.handleCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          code: 'auth-code',
          state: 'opaque-state',
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (Macintosh)',
        }),
      );
    });
  });

  describe('oauthCallback — session and audit', () => {
    it('sets the session cookie on a completed login', async () => {
      const reply = buildReply();

      await handlers.oauthCallback(buildRequest() as never, reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        callbackResult.session_public_id,
        callbackResult.session_refresh_secret,
      );
    });

    it('audits the login with a provider-qualified source', async () => {
      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        {
          access_token: callbackResult.access_token,
          session_public_id: callbackResult.session_public_id,
        },
        'oauth_google',
      );
    });

    it('qualifies the source per provider', async () => {
      await handlers.oauthCallback(
        buildRequest({ params: { provider: 'github' } }) as never,
        buildReply(),
      );

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'oauth_github',
      );
    });

    it('does NOT set a session cookie when MFA is still outstanding', async () => {
      oauthService.handleCallback.mockResolvedValue({ mfa_required: true, mfa_ticket: 'tkt' });

      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it.each([
      ['the session fields are absent', { access_token: 'jwt.only' }],
      [
        'the session fields are the wrong type',
        { access_token: 'jwt', session_public_id: 42, session_refresh_secret: null },
      ],
    ])('sets no cookie when %s', async (_label, data) => {
      oauthService.handleCallback.mockResolvedValue(data);

      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(setSessionCookie).not.toHaveBeenCalled();
    });

    it('sets the cookie but records no login row without an access token', async () => {
      // The guard is deliberately separate: a session without a token is a shape the audit helper
      // cannot describe, and inventing a blank token would corrupt the trail.
      oauthService.handleCallback.mockResolvedValue({
        session_public_id: 'ses_abcdefghijklmnopqrst',
        session_refresh_secret: 'refresh-secret',
      });

      await handlers.oauthCallback(buildRequest() as never, buildReply());

      expect(setSessionCookie).toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('records a provider-qualified failure and re-raises the original error', async () => {
      const failure = new Error('state mismatch');
      oauthService.handleCallback.mockRejectedValue(failure);

      await expect(handlers.oauthCallback(buildRequest() as never, buildReply())).rejects.toBe(
        failure,
      );
      expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        'oauth_google',
        failure,
      );
    });

    it('mints no session on a failed exchange', async () => {
      oauthService.handleCallback.mockRejectedValue(new Error('state mismatch'));

      await expect(handlers.oauthCallback(buildRequest() as never, buildReply())).rejects.toThrow();

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('listOauthProviders', () => {
    it('serializes the configured provider list', async () => {
      const result = await handlers.listOauthProviders(buildRequest(), buildReply());

      expect(result).toEqual({
        data: { serialized: 'oauthProviders', data: ['google'] },
        requestId: 'req_test',
      });
    });
  });
});
