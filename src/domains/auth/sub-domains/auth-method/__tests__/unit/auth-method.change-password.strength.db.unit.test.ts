import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { users } from '@/domains/user/user.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { ValidationError } from '@/shared/errors/index.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';

/**
 * Password-strength wiring for `changePassword`. The gate must run AFTER current-password
 * verification and BEFORE the password is hashed/committed, so a weak new password is rejected
 * without mutating state. Enforcement is flag-gated; the harness disables it globally, so this
 * suite turns it on (with HIBP off — no outbound call). The route's recent-step-up pre-handler is
 * bypassed by calling the service directly, mirroring the existing atomicity db-unit test.
 */
describe('AuthMethodService.changePassword — strength enforcement', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);
  const sessionService = {
    revokeAllSessions: vi.fn().mockResolvedValue(undefined),
    revokeAllSessionsExceptCurrent: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthMethodService(
    userService,
    new AuthMethodRepository(),
    {} as never,
    sessionService as never,
  );

  beforeAll(() => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'true';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
  });
  afterAll(() => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'false';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
  });
  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  it('rejects a weak new password, leaving the stored hash unchanged and no session revoked', async () => {
    const { user, password } = await createTestUserWithPassword();
    const originalHash = user.password_hash;

    await expect(
      service.changePassword(user.public_id, {
        current_password: password,
        new_password: 'aaaaaaaaaaaaaa',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const [persisted] = await database
      .select({ password_hash: users.password_hash })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.password_hash).toBe(originalHash);
    // Rejected before the transaction opens → no session revocation attempted.
    expect(sessionService.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('verifies the current password before assessing strength (wrong current → 401, not weak-password 400)', async () => {
    const { user } = await createTestUserWithPassword();

    await expect(
      service.changePassword(user.public_id, {
        current_password: 'DefinitelyWrongCurrent!1',
        new_password: '9vZ!q4Xr72$KmLw8Tn3p',
      }),
    ).rejects.toMatchObject({ messageKey: 'errors:currentPasswordIncorrect' });
  });

  it('accepts a strong new password and commits the change', async () => {
    const { user, password } = await createTestUserWithPassword();
    const originalHash = user.password_hash;

    await service.changePassword(user.public_id, {
      current_password: password,
      new_password: '9vZ!q4Xr72$KmLw8Tn3p',
    });

    const [persisted] = await database
      .select({ password_hash: users.password_hash })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.password_hash).not.toBe(originalHash);
    expect(sessionService.revokeAllSessions).toHaveBeenCalledTimes(1);
  });
});
