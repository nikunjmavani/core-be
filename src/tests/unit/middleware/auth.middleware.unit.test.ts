import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import authMiddleware from '@/shared/middlewares/core/auth.middleware.js';

async function createAuthMiddlewareApplication() {
  const application = Fastify();
  application.decorate('authDomain', {
    authSessionService: {
      verifyActiveAccessToken: vi.fn().mockResolvedValue(undefined),
    },
  } as never);
  await application.register(authMiddleware);
  application.get(
    '/protected',
    { preHandler: (request, reply) => application.authenticate(request, reply) },
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
  });

  it('rejects invalid Authorization header format', async () => {
    application = await createAuthMiddlewareApplication();
    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Token not-a-bearer-token' },
    });
    expect(response.statusCode).toBe(401);
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
  });
});
