import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { users } from '@/domains/user/user.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import { hashEmailOtp } from '@/domains/auth/sub-domains/auth-method/email-otp.js';
import { createTestUser } from '@/tests/factories/user.factory.js';

/**
 * audit-#12: email verification keeps the one-time code consumption and the
 * `users.is_email_verified` update in ONE atomic transaction. These DB-backed tests prove the happy
 * path commits and that a failure after consumption rolls the consumption back so the single-use
 * code stays redeemable. The attempt cap uses the real Redis connection (default constructor dep).
 */
describe('AuthMethodService.verifyEmail (email OTP atomicity — audit-#12)', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);
  const verificationTokenRepository = new VerificationTokenRepository();

  const service = new AuthMethodService(
    userService,
    new AuthMethodRepository(),
    verificationTokenRepository,
    {} as never,
  );

  const VERIFICATION_CODE = '424242';

  async function seedEmailVerificationCode(userId: number, email: string) {
    const codeHash = hashEmailOtp(VERIFICATION_CODE);
    await verificationTokenRepository.create(
      'EMAIL_VERIFICATION',
      userId,
      email,
      codeHash,
      new Date(Date.now() + 3_600_000),
    );
    return { code: VERIFICATION_CODE, codeHash };
  }

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the code redeemable when the verified-flag update fails', async () => {
    const user = await createTestUser({ email: 'verify-rollback@example.com' });
    const { code, codeHash } = await seedEmailVerificationCode(user.id, user.email);

    vi.spyOn(userService, 'updateEmailVerified').mockRejectedValueOnce(
      new Error('forced update failure'),
    );

    await expect(service.verifyEmail({ email: user.email, code })).rejects.toThrow(
      'forced update failure',
    );

    // Rollback proven: the code was NOT permanently consumed and remains valid for a retry.
    const stillValid = await verificationTokenRepository.findValidByTokenHash(codeHash);
    expect(stillValid).not.toBeNull();

    const [persisted] = await database
      .select({ is_email_verified: users.is_email_verified })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.is_email_verified).toBe(false);
  });

  it('consumes the code and marks the email verified on the happy path', async () => {
    const user = await createTestUser({ email: 'verify-happy@example.com' });
    const { code, codeHash } = await seedEmailVerificationCode(user.id, user.email);

    const result = await service.verifyEmail({ email: user.email, code });
    expect(result.messageKey).toBe('success:emailVerified');

    const consumed = await verificationTokenRepository.findValidByTokenHash(codeHash);
    expect(consumed).toBeNull();

    const [persisted] = await database
      .select({ is_email_verified: users.is_email_verified })
      .from(users)
      .where(eq(users.id, user.id));
    expect(persisted!.is_email_verified).toBe(true);
  });
});
