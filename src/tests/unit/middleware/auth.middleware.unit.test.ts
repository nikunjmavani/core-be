import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import authMiddleware from '@/shared/middlewares/core/auth.middleware.js';

/**
 * Mutation-hardened to 84.6% (Stryker, scoped). The four residual survivors are equivalent
 * mutants — no observable behaviour difference, not worth contorting the code to kill:
 *   - `authDomain?.authSessionService` optional-chaining and the `!authSessionService` guard
 *     both normalise to the same `401 errors:validation.invalidToken` via the surrounding
 *     try/catch, whether the value is missing or the access throws a TypeError.
 *   - the `fp(..., { name: 'auth-middleware' })` plugin-name option only affects
 *     fastify-plugin dependency dedup, which is not observable from a single registration.
 * Everything with a real behavioural footprint (header guards, both short-circuits, and the
 * UnauthorizedError passthrough) is pinned below.
 */

async function createAuthMiddlewareApplication() {
  const application = Fastify();
  application.decorate('authDomain', {
    authSessionService: {
      verifyActiveAccessToken: vi.fn().mockResolvedValue(undefined),
    },
  } as never);
  application.decorate('tenancyDomain', {
    organizationApiKeyService: {
      // Default: no API key match, so the non-API-key tests fall through to the bearer path.
      authenticate: vi.fn().mockResolvedValue(null),
    },
  } as never);
  await application.register(authMiddleware);
  application.get(
    '/protected',
    { preHandler: (request, reply) => application.authenticate(request, reply) },
    async (request) => request.auth,
  );
  // A route whose first preHandler pre-populates `request.auth`, so the `authenticate`
  // preHandler must take the already-authenticated short-circuit and skip session lookup.
  application.get(
    '/pre-authed',
    {
      preHandler: [
        async (request) => {
          request.auth = { kind: 'user', userId: 'pre-existing-user' } as never;
        },
        (request, reply) => application.authenticate(request, reply),
      ],
    },
    async (request) => request.auth,
  );
  await application.ready();
  return application;
}

describe('auth.middleware', () => {
  let application: Awaited<ReturnType<typeof createAuthMiddlewareApplication>>;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('rejects requests without Authorization header', async () => {
    application = await createAuthMiddlewareApplication();
    const response = await application.inject({ method: 'GET', url: '/protected' });
    expect(response.statusCode).toBe(401);
    // Assert the *specific* missing-header message, not just 401: a mutant that drops the
    // `!authorizationHeader` guard falls through to the regex and yields the malformed-header
    // error instead — same status, different message — so status alone cannot catch it.
    expect(response.json().message).toBe('errors:missingAuthorizationHeader');
  });

  it('rejects invalid Authorization header format', async () => {
    application = await createAuthMiddlewareApplication();
    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Token not-a-bearer-token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('errors:invalidAuthorizationHeaderFormat');
  });

  it('rejects invalid or expired bearer tokens', async () => {
    application = await createAuthMiddlewareApplication();
    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid.jwt.token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('sets request.auth for valid bearer tokens', async () => {
    application = await createAuthMiddlewareApplication();
    const userPublicId = generatePublicId();
    /** Session lookup is mocked on `authSessionService.verifyActiveAccessToken`, so we
     * sign the JWT directly instead of using `generateTestToken` (which persists a real
     * session row via `database.select`). Keeps this a true unit test of the middleware. */
    const accessToken = await signAccessToken({ userId: userPublicId, role: 'user' });

    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'user', userId: userPublicId, role: 'user' });
  });

  it('omits role on request.auth when JWT payload has no role', async () => {
    application = await createAuthMiddlewareApplication();
    const userPublicId = generatePublicId();
    const { signAccessToken } = await import('@/shared/utils/security/jwt.util.js');
    const accessToken = await signAccessToken({ userId: userPublicId });

    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'user', userId: userPublicId, role: undefined });
  });

  it('rejects bearer when session is revoked or missing in database', async () => {
    application = await createAuthMiddlewareApplication();
    const userPublicId = generatePublicId();
    const accessToken = await signAccessToken({ userId: userPublicId, role: 'user' });

    const authSessionService = application.authDomain?.authSessionService;
    vi.mocked(authSessionService!.verifyActiveAccessToken).mockRejectedValueOnce(
      new UnauthorizedError(
        'errors:invalidOrExpiredSession',
        undefined,
        'Invalid or expired session',
      ),
    );

    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(authSessionService!.verifyActiveAccessToken).toHaveBeenCalledWith(accessToken);
    // The original UnauthorizedError must propagate unchanged — the catch block re-throws
    // `instanceof UnauthorizedError` as-is rather than re-wrapping it as the generic
    // invalid-token error. Asserting the specific session message pins that passthrough; a
    // mutant that skips the re-throw would surface 'errors:validation.invalidToken' instead.
    expect(response.json().message).toBe('Invalid or expired session');
  });

  it('short-circuits when request.auth is already set (idempotent re-auth)', async () => {
    application = await createAuthMiddlewareApplication();
    const authSessionService = application.authDomain?.authSessionService;

    // No Authorization header at all: the only way this succeeds is the already-authenticated
    // early return. A mutant that drops that branch falls through to bearer extraction → 401.
    const response = await application.inject({ method: 'GET', url: '/pre-authed' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'user', userId: 'pre-existing-user' });
    expect(authSessionService!.verifyActiveAccessToken).not.toHaveBeenCalled();
  });

  it('short-circuits when API-key authentication succeeds (no bearer token required)', async () => {
    application = await createAuthMiddlewareApplication();
    vi.mocked(
      application.tenancyDomain.organizationApiKeyService.authenticate,
    ).mockResolvedValueOnce({
      public_id: 'key_public_id',
      organization_public_id: 'org_public_id',
      scopes: ['api-key:read'],
    } as never);
    const authSessionService = application.authDomain?.authSessionService;

    // An `ApiKey` Authorization header (not a Bearer): success here proves the middleware
    // returned on the API-key branch. A mutant that drops it falls through to getBearerToken,
    // which rejects the non-Bearer scheme → 401.
    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'ApiKey ak_validkey000000000000000000000000' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'apiKey',
      organizationPublicId: 'org_public_id',
    });
    expect(authSessionService!.verifyActiveAccessToken).not.toHaveBeenCalled();
  });
});
