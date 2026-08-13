import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, UnauthorizedError } from '@/shared/errors/index.js';

const clearSessionCookie = vi.fn();
const setSessionCookie = vi.fn();
const parseSessionCookieValue = vi.fn();
const recordScopedAuditEvent = vi.fn();
const verifyAccessToken = vi.fn();
const requireAllowedSourceOriginForCookieSessionRoute = vi.fn();

vi.mock('@/domains/auth/auth.http.util.js', () => ({
  SESSION_COOKIE_NAME: 'session_id',
  clearSessionCookie: (...args: unknown[]) => clearSessionCookie(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
  parseSessionCookieValue: (...args: unknown[]) => parseSessionCookieValue(...args),
}));

vi.mock('@/shared/utils/infrastructure/audit-request-context.util.js', () => ({
  recordScopedAuditEvent: (...args: unknown[]) => recordScopedAuditEvent(...args),
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  verifyAccessToken: (...args: unknown[]) => verifyAccessToken(...args),
}));

vi.mock('@/shared/middlewares/session/cookie-session-origin.pre-handler.js', () => ({
  requireAllowedSourceOriginForCookieSessionRoute: (...args: unknown[]) =>
    requireAllowedSourceOriginForCookieSessionRoute(...args),
}));

vi.mock('@/domains/auth/auth.serializer.js', () => ({
  AuthSerializer: {
    accessToken: (data: unknown) => ({ serialized: 'accessToken', data }),
    accessTokenWithActiveOrganization: (data: unknown, context: unknown) => ({
      serialized: 'accessTokenWithActiveOrganization',
      data,
      context,
    }),
  },
}));

vi.mock('@/domains/auth/sub-domains/auth-session/auth-session.serializer.js', () => ({
  serializeAuthSessions: (rows: unknown, options: unknown) => ({ rows, options }),
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthSessionHandlers } = await import(
  '@/domains/auth/handlers/auth-session.handlers.js'
);

const USER = 'usr_abcdefghijklmnopqrst';
const SESSION = 'ses_abcdefghijklmnopqrst';
const OTHER_SESSION = 'ses_zyxwvutsrqponmlkjih';

function buildAuth(overrides: Record<string, unknown> = {}) {
  return { kind: 'user', userId: USER, sessionPublicId: SESSION, role: 'user', ...overrides };
}

function buildRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    id: 'req_test',
    headers: { authorization: 'Bearer jwt.access.token' },
    auth: buildAuth(),
    ...overrides,
  } as unknown as FastifyRequest;
}

function buildReply(): FastifyReply & { code: ReturnType<typeof vi.fn> } {
  const reply = {
    code: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn> };
}

/**
 * Session management — logout, refresh, revoke, revoke-all and the tenant switches. The largest
 * auth handler and, until now, entirely untested, despite carrying four invariants that each
 * exist because of a specific past defect and each fail silently if broken:
 *
 * - route-#9: revoking your OWN session through the revoke endpoint is a 409, not a success.
 *   Allowing it leaves a stale session cookie and 401s the caller's next request instead of
 *   directing them to logout, which also clears the cookie.
 * - sec-new-A3: revoke-all preserves the caller's own session, so the client is not logged out
 *   by an action meant to evict everyone else.
 * - sec-r4-A1: revoke-all must NOT clear the session cookie. Clearing it destroys the
 *   browser-side refresh token for the session sec-new-A3 just preserved, silently logging the
 *   caller out on their next refresh while the DB row is still alive.
 * - logout must succeed on an EXPIRED token: the token is only used to attribute the audit row,
 *   so a failed verification skips attribution rather than blocking the logout.
 */
describe('auth-session.handlers', () => {
  const logout = vi.fn();
  const refreshToken = vi.fn();
  const switchToPersonal = vi.fn();
  const switchToOrganization = vi.fn();
  const list = vi.fn();
  const revoke = vi.fn();
  const revokeAllSessionsExceptCurrent = vi.fn();
  const getActiveOrganizationContext = vi.fn();

  const handlers = createAuthSessionHandlers({
    authService: { logout, refreshToken, switchToPersonal, switchToOrganization },
    authSessionService: { list, revoke, revokeAllSessionsExceptCurrent },
    authMeContextService: { getActiveOrganizationContext },
  } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    verifyAccessToken.mockResolvedValue({ userId: USER });
    getActiveOrganizationContext.mockResolvedValue({ permissions: [] });
  });

  describe('logout', () => {
    it('revokes the token, clears the cookie and answers 204', async () => {
      const reply = buildReply();

      await handlers.logout(buildRequest(), reply);

      expect(logout).toHaveBeenCalledWith('jwt.access.token');
      expect(clearSessionCookie).toHaveBeenCalledWith(reply);
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it('records the logout audit event attributed to the token subject', async () => {
      await handlers.logout(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorUserPublicId: USER,
          action: 'auth.logout',
          resource_type: 'session',
        }),
      );
    });

    it('still logs out when the access token is EXPIRED', async () => {
      // The token is only used to attribute the audit row — a failed verification must not
      // block the caller from ending their session.
      verifyAccessToken.mockRejectedValue(new Error('jwt expired'));
      const reply = buildReply();

      await handlers.logout(buildRequest(), reply);

      expect(logout).toHaveBeenCalledWith('jwt.access.token');
      expect(clearSessionCookie).toHaveBeenCalledWith(reply);
    });

    it('skips audit attribution when the token cannot be verified', async () => {
      verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

      await handlers.logout(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing Authorization header', {}],
      ['a non-Bearer scheme', { authorization: 'Basic abc' }],
      ['a Bearer with no token', { authorization: 'Bearer ' }],
    ])('rejects %s with Unauthorized', async (_label, headers) => {
      await expect(handlers.logout(buildRequest({ headers }), buildReply())).rejects.toBeInstanceOf(
        UnauthorizedError,
      );

      expect(logout).not.toHaveBeenCalled();
    });

    it('accepts a lowercase bearer scheme', async () => {
      await handlers.logout(
        buildRequest({ headers: { authorization: 'bearer jwt.access.token' } }),
        buildReply(),
      );

      expect(logout).toHaveBeenCalledWith('jwt.access.token');
    });
  });

  describe('listSessions', () => {
    it('marks which row is the caller current session', async () => {
      list.mockResolvedValue([{ public_id: SESSION }]);

      const result = await handlers.listSessions(buildRequest(), buildReply());

      expect(list).toHaveBeenCalledWith(USER);
      expect(result).toMatchObject({
        data: { options: { currentSessionPublicId: SESSION } },
      });
    });

    it('passes null when the caller has no session id on the token', async () => {
      list.mockResolvedValue([]);

      const result = await handlers.listSessions(
        buildRequest({ auth: buildAuth({ sessionPublicId: undefined }) }),
        buildReply(),
      );

      expect(result).toMatchObject({ data: { options: { currentSessionPublicId: null } } });
    });
  });

  describe('revokeSession (route-#9)', () => {
    it('revokes another session and answers 204', async () => {
      const reply = buildReply();

      await handlers.revokeSession(
        buildRequest({ params: { session_id: OTHER_SESSION } }) as never,
        reply,
      );

      expect(revoke).toHaveBeenCalledWith(USER, OTHER_SESSION);
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it('REFUSES to revoke the caller own session with a 409', async () => {
      // Allowing it would leave a stale cookie and 401 the next request instead of pointing the
      // caller at logout, which also clears the cookie.
      await expect(
        handlers.revokeSession(
          buildRequest({ params: { session_id: SESSION } }) as never,
          buildReply(),
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(revoke).not.toHaveBeenCalled();
    });

    it('carries the documented translation key on that conflict', async () => {
      await expect(
        handlers.revokeSession(
          buildRequest({ params: { session_id: SESSION } }) as never,
          buildReply(),
        ),
      ).rejects.toMatchObject({ statusCode: 409, messageKey: 'errors:cannotRevokeCurrentSession' });
    });

    it('allows revocation when the caller token carries no session id', async () => {
      // The guard is scoped to a KNOWN current session; an absent id must not block the route.
      await handlers.revokeSession(
        {
          ...buildRequest({ params: { session_id: OTHER_SESSION } }),
          auth: buildAuth({ sessionPublicId: undefined }),
        } as never,
        buildReply(),
      );

      expect(revoke).toHaveBeenCalledWith(USER, OTHER_SESSION);
    });

    it('records the revocation with the target session in metadata', async () => {
      await handlers.revokeSession(
        buildRequest({ params: { session_id: OTHER_SESSION } }) as never,
        buildReply(),
      );

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.session.revoke',
          metadata: { session_public_id: OTHER_SESSION },
        }),
      );
    });
  });

  describe('refreshToken', () => {
    beforeEach(() => {
      parseSessionCookieValue.mockReturnValue({
        sessionPublicId: SESSION,
        refreshSecret: 'old-secret',
      });
      refreshToken.mockResolvedValue({ access_token: 'new.jwt', refresh_secret: 'new-secret' });
    });

    it('enforces the Origin allowlist before touching the cookie', async () => {
      await handlers.refreshToken(
        buildRequest({ cookies: { session_id: 'raw-cookie' } }),
        buildReply(),
      );

      expect(requireAllowedSourceOriginForCookieSessionRoute).toHaveBeenCalled();
    });

    it('does not proceed when the origin pre-handler rejects', async () => {
      requireAllowedSourceOriginForCookieSessionRoute.mockImplementationOnce(() => {
        throw new UnauthorizedError('errors:invalidOrigin');
      });

      await expect(
        handlers.refreshToken(buildRequest({ cookies: { session_id: 'raw' } }), buildReply()),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(refreshToken).not.toHaveBeenCalled();
    });

    it('rotates the refresh secret into a freshly-set cookie', async () => {
      const reply = buildReply();

      await handlers.refreshToken(buildRequest({ cookies: { session_id: 'raw' } }), reply);

      // Rotation is the whole point: the new secret must replace the old one in the cookie.
      expect(setSessionCookie).toHaveBeenCalledWith(reply, SESSION, 'new-secret');
    });

    it.each([
      ['no cookies at all', undefined],
      ['an empty cookie jar', {}],
    ])('rejects %s with Unauthorized', async (_label, cookies) => {
      await expect(
        handlers.refreshToken(buildRequest({ cookies }), buildReply()),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(refreshToken).not.toHaveBeenCalled();
    });

    it('rejects a malformed cookie the parser cannot read', async () => {
      parseSessionCookieValue.mockReturnValue(null);

      await expect(
        handlers.refreshToken(buildRequest({ cookies: { session_id: 'garbage' } }), buildReply()),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions (sec-new-A3 + sec-r4-A1)', () => {
    it('passes the caller current token so their own session survives', async () => {
      await handlers.revokeAllSessions(buildRequest(), buildReply());

      expect(revokeAllSessionsExceptCurrent).toHaveBeenCalledWith({
        userPublicId: USER,
        currentAccessToken: 'jwt.access.token',
      });
    });

    it('does NOT clear the session cookie', async () => {
      // sec-r4-A1: clearing it would destroy the browser-side refresh token for the session
      // sec-new-A3 deliberately preserved — silently logging the caller out on next refresh.
      await handlers.revokeAllSessions(buildRequest(), buildReply());

      expect(clearSessionCookie).not.toHaveBeenCalled();
    });

    it('answers 204 and records the bulk revocation', async () => {
      const reply = buildReply();

      await handlers.revokeAllSessions(buildRequest(), reply);

      expect(reply.code).toHaveBeenCalledWith(204);
      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'auth.session.revoke_all' }),
      );
    });

    it('degrades to an empty token rather than throwing when the header is absent', async () => {
      await handlers.revokeAllSessions(buildRequest({ headers: {} }), buildReply());

      expect(revokeAllSessionsExceptCurrent).toHaveBeenCalledWith({
        userPublicId: USER,
        currentAccessToken: '',
      });
    });
  });

  describe('tenant switches', () => {
    beforeEach(() => {
      switchToPersonal.mockResolvedValue({ organization_public_id: null });
      switchToOrganization.mockResolvedValue({ organization_public_id: 'org_target' });
    });

    it('switch-to-personal audits the tenant-context change', async () => {
      await handlers.switchToPersonalOrganization(buildRequest(), buildReply());

      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.organization.switch',
          metadata: { session_public_id: SESSION, target: 'personal' },
        }),
      );
    });

    it('switch-to-organization audits the target organization', async () => {
      await handlers.switchToOrganization(
        buildRequest({ body: { organization_id: 'org_target' } }),
        buildReply(),
      );

      expect(switchToOrganization).toHaveBeenCalledWith({
        userPublicId: USER,
        sessionPublicId: SESSION,
        organizationPublicId: 'org_target',
      });
      expect(recordScopedAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.organization.switch',
          metadata: { session_public_id: SESSION, target_organization_id: 'org_target' },
        }),
      );
    });

    it('resolves the new active-org context AFTER the switch re-minted the token', async () => {
      // Ordering matters: reading context before the service gate would expose an org the caller
      // may not belong to.
      await handlers.switchToOrganization(
        buildRequest({ body: { organization_id: 'org_target' } }),
        buildReply(),
      );

      expect(getActiveOrganizationContext).toHaveBeenCalledWith({
        userPublicId: USER,
        organizationPublicId: 'org_target',
        globalRole: 'user',
      });
    });

    it.each([
      ['switchToPersonalOrganization', 'switchToPersonalOrganization'],
      ['switchToOrganization', 'switchToOrganization'],
    ] as const)('%s rejects a token with no session id', async (_label, method) => {
      const request = buildRequest({
        auth: buildAuth({ sessionPublicId: undefined }),
        body: { organization_id: 'org_target' },
      });

      await expect(handlers[method](request, buildReply())).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('switchToOrganization rejects a non-user principal', async () => {
      const request = buildRequest({
        auth: { kind: 'organization-api-key', userId: USER, sessionPublicId: SESSION },
        body: { organization_id: 'org_target' },
      });

      await expect(handlers.switchToOrganization(request, buildReply())).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(switchToOrganization).not.toHaveBeenCalled();
    });
  });
});
