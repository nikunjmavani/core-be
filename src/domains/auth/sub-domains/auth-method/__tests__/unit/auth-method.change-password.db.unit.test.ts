import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { users } from '@/domains/user/user.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';

/**
 * audit-#4: `changePassword` must apply the password update and the session
 * revocation as ONE atomic database transaction. These DB-backed tests prove the
 * happy path commits and — critically — that a failure during session revocation
 * rolls the password change back, so an attacker's session can never survive a
 * password change that the caller believes succeeded.
 */
describe('AuthMethodService.changePassword (atomicity — audit-#4)', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);

  function buildService(authSessionServiceStub: unknown): AuthMethodService {
    return new AuthMethodService(
      userService,
      new AuthMethodRepository(),
      {} as never,
      authSessionServiceStub as never,
    );
  }

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  it('rolls the password change back when session revocation fails', async () => {
    const { user, password } = await createTestUserWithPassword();
    const originalHash = user.password_hash;
    expect(originalHash).toBeTruthy();

    const failingSessionService = {
      revokeAllSessions: vi.fn().mockRejectedValue(new Error('forced revoke failure')),
      revokeAllSessionsExceptCurrent: vi.fn(),
    };
    const service = buildService(failingSessionService);

    await expect(
      service.changePassword(user.public_id, {
        current_password: password,
        new_password: 'BrandNewPassword456!',
      }),
    ).rejects.toThrow('forced revoke failure');

    // The transaction must have rolled back: the stored hash is unchanged, so the OLD
    // password still verifies and no half-applied state (changed password, live sessions)
    // exists.
    const [persisted] = await database
      .select({ password_hash: users.password_hash })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.password_hash).toBe(originalHash);
  });

  it('commits the password change and revokes other sessions on the happy path', async () => {
    const { user, password } = await createTestUserWithPassword();
    const originalHash = user.password_hash;

    const sessionService = {
      revokeAllSessions: vi.fn().mockResolvedValue(undefined),
      revokeAllSessionsExceptCurrent: vi.fn().mockResolvedValue(undefined),
    };
    const service = buildService(sessionService);

    await service.changePassword(user.public_id, {
      current_password: password,
      new_password: 'BrandNewPassword456!',
    });

    const [persisted] = await database
      .select({ password_hash: users.password_hash })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.password_hash).not.toBe(originalHash);
    // No current access token supplied → all sessions revoked (in the same committed transaction).
    expect(sessionService.revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(sessionService.revokeAllSessionsExceptCurrent).not.toHaveBeenCalled();
  });
});
