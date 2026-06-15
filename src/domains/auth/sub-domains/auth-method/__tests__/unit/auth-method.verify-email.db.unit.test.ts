import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { users } from '@/domains/user/user.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import { createTestUser } from '@/tests/factories/user.factory.js';

/**
 * audit-#12: email verification must keep the one-time token consumption and the
 * `users.is_email_verified` update in ONE atomic transaction. These DB-backed
 * tests prove the happy path commits and that a failure after consumption rolls
 * the consumption back so the single-use link stays redeemable.
 */
describe('AuthMethodService.verifyEmail (one-time-token atomicity — audit-#12)', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);
  const verificationTokenRepository = new VerificationTokenRepository();

  const service = new AuthMethodService(
    userService,
    new AuthMethodRepository(),
    verificationTokenRepository,
    {} as never,
  );

  async function seedEmailVerificationToken(userId: number, email: string) {
    const rawToken = `verify-${userId}-${Date.now()}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await verificationTokenRepository.create(
      'EMAIL_VERIFICATION',
      userId,
      email,
      tokenHash,
      new Date(Date.now() + 3_600_000),
    );
    return { rawToken, tokenHash };
  }

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the token redeemable when the verified-flag update fails', async () => {
    const user = await createTestUser({ email: 'verify-rollback@example.com' });
    const { rawToken, tokenHash } = await seedEmailVerificationToken(user.id, user.email);

    vi.spyOn(userService, 'updateEmailVerified').mockRejectedValueOnce(
      new Error('forced update failure'),
    );

    await expect(service.verifyEmail({ token: rawToken })).rejects.toThrow('forced update failure');

    // Rollback proven: the token was NOT permanently consumed and remains valid for a retry.
    const stillValid = await verificationTokenRepository.findValidByTokenHash(tokenHash);
    expect(stillValid).not.toBeNull();

    const [persisted] = await database
      .select({ is_email_verified: users.is_email_verified })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.is_email_verified).toBe(false);
  });

  it('consumes the token and marks the email verified on the happy path', async () => {
    const user = await createTestUser({ email: 'verify-happy@example.com' });
    const { rawToken, tokenHash } = await seedEmailVerificationToken(user.id, user.email);

    const result = await service.verifyEmail({ token: rawToken });
    expect(result.messageKey).toBe('success:emailVerified');

    const consumed = await verificationTokenRepository.findValidByTokenHash(tokenHash);
    expect(consumed).toBeNull();

    const [persisted] = await database
      .select({ is_email_verified: users.is_email_verified })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.is_email_verified).toBe(true);
  });
});
