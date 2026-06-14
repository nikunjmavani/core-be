import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * sec-audit-#16 (fail-closed): `rederiveSuperAdminRole` re-checks a signed SUPER_ADMIN claim
 * against the live allowlist + account state on every request. When the user-domain is NOT wired
 * (`request.server.userDomain` missing) it can't perform that re-check, so it must DENY the
 * re-grant in production rather than silently trusting the baked-in claim — otherwise a stale
 * privileged token (e.g. email already removed from GLOBAL_ADMIN_EMAILS, or a suspended account)
 * would sail through for the rest of the token lifetime.
 *
 * The branch is `env.NODE_ENV === 'test' ? SUPER_ADMIN : undefined` (the test seam keeps minimal
 * harnesses that register auth without the full user domain working). To exercise the PRODUCTION
 * path we partial-mock env: spread the real values (so `signAccessToken` / `verifyAccessToken`
 * keep their real JWT keys) and flip only `NODE_ENV` to `production` for this file.
 */
vi.mock('@/shared/config/env.config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/shared/config/env.config.js');
  return { env: { ...actual.env, NODE_ENV: 'production' } };
});

// Also mock the allowlist resolver so we can control whether the live check passes.
vi.mock('@/shared/utils/auth/global-admin-role.util.js', () => ({
  resolveGlobalRoleForEmail: vi.fn(),
}));

import authMiddleware from '@/shared/middlewares/core/auth.middleware.js';
import { resolveGlobalRoleForEmail } from '@/shared/utils/auth/global-admin-role.util.js';

describe('auth.middleware — super_admin re-derive fails closed without userDomain (sec-audit-#16)', () => {
  let application: FastifyInstance;

  async function setup({ withUserDomain }: { withUserDomain: boolean }): Promise<void> {
    application = Fastify();
    application.decorate('authDomain', {
      authSessionService: {
        verifyActiveAccessToken: vi.fn().mockResolvedValue({ sessionPublicId: 'sess_test' }),
      },
    } as never);
    application.decorate('tenancyDomain', {
      organizationApiKeyService: { authenticate: vi.fn().mockResolvedValue(null) },
    } as never);
    if (withUserDomain) {
      // A correctly-wired user domain that still resolves the account as an active allowlisted
      // super-admin — proves the test merely toggles the presence of the domain, not the verdict.
      application.decorate('userDomain', {
        userService: {
          findUserRecordByPublicId: vi.fn().mockResolvedValue({
            id: 1,
            public_id: 'user_pub',
            email: 'admin@example.com',
            status: 'ACTIVE',
            is_email_verified: true,
          }),
        },
      } as never);
    }
    await application.register(authMiddleware);
    application.get(
      '/protected',
      { preHandler: (req, reply) => application.authenticate(req, reply) },
      async (req) => req.auth,
    );
    await application.ready();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: email is in the allowlist (controls the `withUserDomain: true` test below).
    vi.mocked(resolveGlobalRoleForEmail).mockReturnValue(GLOBAL_ROLES.SUPER_ADMIN);
  });

  it('denies the SUPER_ADMIN re-grant (role undefined) when userDomain is not wired in production', async () => {
    await setup({ withUserDomain: false });
    const accessToken = await signAccessToken({
      userId: generatePublicId('user'),
      role: GLOBAL_ROLES.SUPER_ADMIN,
    });

    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    // The token authenticates (valid signature) but the privileged claim is dropped: with no
    // userDomain to re-check live state, production must not preserve super_admin.
    expect(response.statusCode).toBe(200);
    expect((response.json() as { role?: string }).role).toBeUndefined();
    await application.close();
  });

  it('still grants SUPER_ADMIN in production when the user domain confirms the live account', async () => {
    await setup({ withUserDomain: true });
    const accessToken = await signAccessToken({
      userId: generatePublicId('user'),
      role: GLOBAL_ROLES.SUPER_ADMIN,
    });

    const response = await application.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    // Same production env, but now the live re-check can run and confirms the grant.
    expect((response.json() as { role?: string }).role).toBe(GLOBAL_ROLES.SUPER_ADMIN);
    await application.close();
  });
});
