import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSessionCookie = vi.fn();
const readRequestOrigin = vi.fn();
const recordScopedAuditEvent = vi.fn();
const recordLoginAuditEvent = vi.fn();
const recordLoginFailureAuditEvent = vi.fn();

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'Mozilla/5.0 (Macintosh)',
  readRequestOrigin: (...args: unknown[]) => readRequestOrigin(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

vi.mock('@/shared/utils/infrastructure/audit-request-context.util.js', () => ({
  recordScopedAuditEvent: (...args: unknown[]) => recordScopedAuditEvent(...args),
}));

vi.mock('@/domains/auth/shared/audit-login.util.js', () => ({
  recordLoginAuditEvent: (...args: unknown[]) => recordLoginAuditEvent(...args),
  recordLoginFailureAuditEvent: (...args: unknown[]) => recordLoginFailureAuditEvent(...args),
}));

vi.mock('@/domains/auth/auth.serializer.js', () => ({
  AuthSerializer: {
    accessToken: (data: unknown) => ({ serialized: 'accessToken', data }),
    mfaRequired: (data: unknown) => ({ serialized: 'mfaRequired', data }),
  },
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthWebauthnHandlers } = await import(
  '@/domains/auth/handlers/auth-webauthn.handlers.js'
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

const REQUEST_ORIGIN = 'https://origin-read-from-request.invalid';

const loginResult = {
  access_token: 'jwt.access.token',
  session_public_id: 'ses_newnewnewnewnewnewn',
  session_refresh_secret: 'refresh-secret',
};

/**
 * The WebAuthn handlers. The invariant that matters most here is the ORIGIN.
 *
 * A passkey assertion is only meaningful relative to the origin it was produced for — that binding
 * is what makes WebAuthn phishing-resistant. Every ceremony call therefore forwards the request's
 * own origin rather than a configured constant, on all four surfaces: register options, register
 * verify, authenticate options, authenticate verify. If any one of them stopped passing it (or
 * passed a hardcoded value), an assertion minted for an attacker's origin could verify against this
 * server, and the property the whole mechanism exists for would be gone.
 *
 * The second is symmetry of the audit trail: enrolling a passkey is a takeover-PERSISTENCE move
 * (an attacker with a live session adds a credential they own), so registration is audited exactly
 * like revocation. And a passkey login is a login — it records a row through the same helper as
 * password and OAuth, so the auth.overview.md "every login records a row" invariant holds across
 * every entrypoint rather than every entrypoint except this one.
 */
describe('auth-webauthn.handlers', () => {
  const webauthnService = {
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    listCredentials: vi.fn(),
    revokeCredential: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
  };
  const handlers = createAuthWebauthnHandlers({ webauthnService } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    // A deliberately unguessable origin: if a handler ever hardcodes an origin instead of reading
    // the request's, it cannot coincidentally match this value, so these assertions stay honest.
    readRequestOrigin.mockReturnValue(REQUEST_ORIGIN);
    webauthnService.generateRegistrationOptions.mockResolvedValue({ challenge: 'abc' });
    webauthnService.verifyRegistration.mockResolvedValue({
      credential_id: 'wac_abcdefghijklmnopqrstu',
    });
    webauthnService.listCredentials.mockResolvedValue([]);
    webauthnService.revokeCredential.mockResolvedValue(undefined);
    webauthnService.generateAuthenticationOptions.mockResolvedValue({ challenge: 'def' });
    webauthnService.verifyAuthentication.mockResolvedValue(loginResult);
  });

  describe('origin binding — the phishing-resistance property', () => {
    it('forwards the request origin when generating registration options', async () => {
      await handlers.webauthnRegisterOptions(buildRequest(), buildReply());

      expect(webauthnService.generateRegistrationOptions).toHaveBeenCalledWith(
        auth.userId,
        REQUEST_ORIGIN,
      );
    });

    it('forwards the request origin when verifying registration', async () => {
      const request = buildRequest({ body: { id: 'credential' } });

      await handlers.webauthnRegisterVerify(request, buildReply());

      expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
        auth.userId,
        request.body,
        REQUEST_ORIGIN,
      );
    });

    it('forwards the request origin when generating authentication options', async () => {
      const request = buildRequest({ body: { email: 'person@example.com' } });

      await handlers.webauthnAuthenticateOptions(request, buildReply());

      expect(webauthnService.generateAuthenticationOptions).toHaveBeenCalledWith(
        request.body,
        REQUEST_ORIGIN,
      );
    });

    it('forwards the request origin when verifying an assertion', async () => {
      const request = buildRequest({ body: { id: 'credential' } });

      await handlers.webauthnAuthenticateVerify(request, buildReply());

      expect(webauthnService.verifyAuthentication).toHaveBeenCalledWith(
        request.body,
        '203.0.113.7',
        REQUEST_ORIGIN,
        'Mozilla/5.0 (Macintosh)',
      );
    });
  });

  describe('origin provenance', () => {
    it.each([
      ['webauthnRegisterOptions', 'webauthnRegisterOptions'],
      ['webauthnRegisterVerify', 'webauthnRegisterVerify'],
      ['webauthnAuthenticateOptions', 'webauthnAuthenticateOptions'],
      ['webauthnAuthenticateVerify', 'webauthnAuthenticateVerify'],
    ] as const)('%s derives the origin from THIS request', async (_label, handlerName) => {
      // Not just "the right value" — the right SOURCE. A handler that hardcoded a correct-looking
      // origin would satisfy a value assertion while silently discarding the request binding.
      const request = buildRequest();

      await handlers[handlerName](request as never, buildReply());

      expect(readRequestOrigin).toHaveBeenCalledWith(request);
    });
  });

  describe('registration', () => {
    it('audits an enrollment as a credential-adding event', async () => {
      await handlers.webauthnRegisterVerify(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.webauthn.register',
          resource_type: 'webauthn_credential',
          metadata: { credential_id: 'wac_abcdefghijklmnopqrstu' },
        }),
      );
    });

    it('scopes registration to the authenticated user', async () => {
      await handlers.webauthnRegisterOptions(buildRequest(), buildReply());

      expect(webauthnService.generateRegistrationOptions).toHaveBeenCalledWith(
        auth.userId,
        expect.anything(),
      );
    });

    it('records no audit event when the ceremony fails', async () => {
      webauthnService.verifyRegistration.mockRejectedValue(new Error('bad attestation'));

      await expect(handlers.webauthnRegisterVerify(buildRequest(), buildReply())).rejects.toThrow();

      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('credential management', () => {
    it('lists only the authenticated user credentials', async () => {
      await handlers.webauthnListCredentials(buildRequest(), buildReply());

      expect(webauthnService.listCredentials).toHaveBeenCalledWith(auth.userId);
    });

    it('revokes a credential scoped to its owner', async () => {
      // The owner id is passed alongside the credential id, so a valid id belonging to another
      // user cannot be revoked by guessing it.
      const request = buildRequest({ params: { credential_id: 'wac_abcdefghijklmnopqrstu' } });

      await handlers.webauthnRevokeCredential(request as never, buildReply());

      expect(webauthnService.revokeCredential).toHaveBeenCalledWith(
        auth.userId,
        'wac_abcdefghijklmnopqrstu',
      );
    });

    it('answers 204 on revoke', async () => {
      const reply = buildReply();
      const request = buildRequest({ params: { credential_id: 'wac_abcdefghijklmnopqrstu' } });

      await handlers.webauthnRevokeCredential(request as never, reply);

      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it('audits the revocation', async () => {
      const request = buildRequest({ params: { credential_id: 'wac_abcdefghijklmnopqrstu' } });

      await handlers.webauthnRevokeCredential(request as never, buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.webauthn.revoke',
          metadata: { credential_id: 'wac_abcdefghijklmnopqrstu' },
        }),
      );
    });

    it.each([
      ['an empty id', ''],
      ['a whitespace-only id', '   '],
      ['a sequential database id', '42'],
      ['a raw WebAuthn credential blob', 'AQIDBAUGBwgJCgsMDQ4PEA'],
      ['a short suffix', 'wac_abcdefghijklmnopqrst'],
      ['an uppercase suffix', 'wac_ABCDEFGHIJKLMNOPQRSTU'],
      ['a traversal attempt', 'wac_abcdefghijklmnopqrstu/../other'],
    ])('rejects %s before touching the service', async (_label, credential_id) => {
      // route-#10: the param is an opaque public id — never the raw credential blob the browser
      // produced, and never the sequential row id it replaced. Note the handler helper checks the
      // GENERIC public-id shape (any prefix + 21 lowercase alphanumerics); pinning the `wac_`
      // prefix specifically is the route schema's job, covered in webauthn.dto.unit.test.ts.
      const request = buildRequest({ params: { credential_id } });

      await expect(
        handlers.webauthnRevokeCredential(request as never, buildReply()),
      ).rejects.toThrow();
      expect(webauthnService.revokeCredential).not.toHaveBeenCalled();
    });
  });

  describe('passkey login', () => {
    it('sets the session cookie on a completed assertion', async () => {
      const reply = buildReply();

      await handlers.webauthnAuthenticateVerify(buildRequest(), reply);

      expect(setSessionCookie).toHaveBeenCalledWith(
        reply,
        loginResult.session_public_id,
        loginResult.session_refresh_secret,
      );
    });

    it('records a login row tagged webauthn', async () => {
      await handlers.webauthnAuthenticateVerify(buildRequest(), buildReply());

      expect(recordLoginAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        {
          access_token: loginResult.access_token,
          session_public_id: loginResult.session_public_id,
        },
        'webauthn',
      );
    });

    it('does NOT set a session cookie when MFA is still outstanding', async () => {
      webauthnService.verifyAuthentication.mockResolvedValue({
        mfa_required: true,
        mfa_ticket: 'tkt',
      });

      await handlers.webauthnAuthenticateVerify(buildRequest(), buildReply());

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('treats only an explicit mfa_required === true as pending', async () => {
      // A falsy `mfa_required` is a completed login, not a pending one — the check is strict
      // equality rather than a truthiness test on a key that may legitimately be present.
      webauthnService.verifyAuthentication.mockResolvedValue({
        ...loginResult,
        mfa_required: false,
      });

      await handlers.webauthnAuthenticateVerify(buildRequest(), buildReply());

      expect(setSessionCookie).toHaveBeenCalled();
    });

    it.each([
      ['the session fields are absent', { access_token: 'jwt.only' }],
      [
        'the session fields are the wrong type',
        { access_token: 'jwt', session_public_id: 42, session_refresh_secret: null },
      ],
    ])('sets no cookie when %s', async (_label, data) => {
      webauthnService.verifyAuthentication.mockResolvedValue(data);

      await handlers.webauthnAuthenticateVerify(buildRequest(), buildReply());

      expect(setSessionCookie).not.toHaveBeenCalled();
    });

    it('sets the cookie but records no login row without an access token', async () => {
      webauthnService.verifyAuthentication.mockResolvedValue({
        session_public_id: 'ses_abcdefghijklmnopqrst',
        session_refresh_secret: 'refresh-secret',
      });

      await handlers.webauthnAuthenticateVerify(buildRequest(), buildReply());

      expect(setSessionCookie).toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });

    it('records a failure and re-raises the original error', async () => {
      const failure = new Error('assertion rejected');
      webauthnService.verifyAuthentication.mockRejectedValue(failure);

      await expect(handlers.webauthnAuthenticateVerify(buildRequest(), buildReply())).rejects.toBe(
        failure,
      );
      expect(recordLoginFailureAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        'webauthn',
        failure,
      );
    });

    it('mints no session on a failed assertion', async () => {
      webauthnService.verifyAuthentication.mockRejectedValue(new Error('assertion rejected'));

      await expect(
        handlers.webauthnAuthenticateVerify(buildRequest(), buildReply()),
      ).rejects.toThrow();

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(recordLoginAuditEvent).not.toHaveBeenCalled();
    });
  });
});
