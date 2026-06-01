import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { users } from '@/domains/user/user.schema.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import { AUTH_METHOD_TYPE } from '@/domains/auth/sub-domains/auth-method/auth-method.constants.js';
import { completeOAuthUserSession } from '@/domains/auth/sub-domains/auth-method/oauth/oauth-user-session.js';

vi.mock('@/domains/auth/shared/complete-first-factor-auth.js', () => ({
  completeFirstFactorAuth: vi.fn().mockResolvedValue({
    access_token: 'signed-access-token',
    session_public_id: 'session_db_test',
  }),
}));

const organizationSettingsServiceStub = {
  userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
};
const mfaServiceStub = {
  createMfaSession: vi.fn(),
};

const userRepository = new UserRepository();
const userService = new UserService(userRepository, {} as never);

const authSessionServiceStub = {
  createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_db_test' }),
};

describe('completeOAuthUserSession (database transaction boundary)', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  it('rolls back the freshly created user when the auth-method link insert fails', async () => {
    const email = 'oauth-rollback@example.com';
    const failingAuthMethodService = {
      findByProviderUserId: vi.fn().mockResolvedValue(null),
      linkOAuthProviderIfMissing: vi.fn().mockRejectedValue(new Error('forced link failure')),
    };

    await expect(
      completeOAuthUserSession({
        userService,
        authMethodService: failingAuthMethodService as never,
        authSessionService: authSessionServiceStub as never,
        organizationSettingsService: organizationSettingsServiceStub as never,
        mfaService: mfaServiceStub as never,
        provider: 'google',
        profile: { email, provider_user_id: 'google-rollback-1' },
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toThrow('forced link failure');

    const persisted = await database.select().from(users).where(eq(users.email, email));
    expect(persisted).toHaveLength(0);
    expect(authSessionServiceStub.createSessionForUser).not.toHaveBeenCalled();
  });

  it('persists method_type as uppercase OAUTH on a successful first-time signup', async () => {
    const email = 'oauth-signup@example.com';
    const authMethodService = new AuthMethodService(
      {} as never,
      new AuthMethodRepository(),
      {} as never,
      {} as never,
    );

    const result = await completeOAuthUserSession({
      userService,
      authMethodService,
      authSessionService: authSessionServiceStub as never,
      organizationSettingsService: organizationSettingsServiceStub as never,
      mfaService: mfaServiceStub as never,
      provider: 'github',
      profile: { email, provider_user_id: 'github-signup-1', name: 'Octo Cat' },
      ipAddress: '127.0.0.1',
    });

    expect('session_public_id' in result && result.session_public_id).toBe('session_db_test');

    const [createdUser] = await database.select().from(users).where(eq(users.email, email));
    expect(createdUser).toBeDefined();

    const methods = await database
      .select()
      .from(auth_methods)
      .where(and(eq(auth_methods.user_id, createdUser!.id), isNull(auth_methods.revoked_at)));

    expect(methods).toHaveLength(1);
    expect(methods[0]?.method_type).toBe(AUTH_METHOD_TYPE.OAUTH);
    expect(methods[0]?.method_type).toBe('OAUTH');
  });
});
