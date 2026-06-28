import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import { EmailLoginService } from '@/domains/auth/sub-domains/auth-method/email-login.service.js';
import {
  generateVerificationCode,
  hashVerificationCode,
} from '@/domains/auth/sub-domains/auth-method/verification-code.js';
import { createTestUser } from '@/tests/factories/user.factory.js';

/**
 * audit-#12: email login must keep the one-time code consumption and the downstream first-factor
 * completion (session creation) in ONE atomic transaction. A failure after consumption previously
 * burned a valid single-use code; the pinned transaction now rolls the consumption back so the code
 * stays redeemable. The per-user attempt cap is stubbed (Redis `eval`) so these tests assert DB
 * atomicity deterministically without a Redis dependency.
 */
describe('EmailLoginService.login (one-time-code atomicity — audit-#12)', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);
  const verificationTokenRepository = new VerificationTokenRepository();

  const organizationSettingsServiceStub = {
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  };

  const redisStub = {
    eval: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(0),
  } as unknown as Redis;

  function buildService(authSessionServiceStub: unknown): EmailLoginService {
    return new EmailLoginService(
      userService,
      verificationTokenRepository,
      organizationSettingsServiceStub as never,
      { createMfaSession: vi.fn() } as never,
      authSessionServiceStub as never,
      {} as never,
      redisStub,
    );
  }

  async function seedEmailCode(userId: number, email: string) {
    const code = generateVerificationCode();
    const codeHash = hashVerificationCode({ tokenType: 'EMAIL_CODE', userId, code });
    await verificationTokenRepository.create(
      'EMAIL_CODE',
      userId,
      email,
      codeHash,
      new Date(Date.now() + 900_000),
    );
    return { code, codeHash };
  }

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the code redeemable when session creation fails after consumption', async () => {
    const user = await createTestUser({ email: 'email-code-rollback@example.com' });
    const { code, codeHash } = await seedEmailCode(user.id, user.email);

    const service = buildService({
      createSessionForUser: vi.fn().mockRejectedValue(new Error('forced session failure')),
    });

    await expect(service.login({ email: user.email, code }, '127.0.0.1')).rejects.toThrow(
      'forced session failure',
    );

    // Rollback proven: the code was NOT permanently consumed and remains valid for a retry.
    const stillValid = await verificationTokenRepository.findValidByTokenHash(codeHash);
    expect(stillValid).not.toBeNull();
  });

  it('consumes the code and issues a session on the happy path', async () => {
    const user = await createTestUser({ email: 'email-code-happy@example.com' });
    const { code, codeHash } = await seedEmailCode(user.id, user.email);

    const service = buildService({
      createSessionForUser: vi.fn().mockResolvedValue({
        public_id: 'session_pub',
        refresh_secret: 'refresh_secret',
      }),
    });

    const result = await service.login({ email: user.email, code }, '127.0.0.1');
    expect('access_token' in result && result.access_token).toBeTruthy();

    // The code is now consumed (single-use enforced).
    const consumed = await verificationTokenRepository.findValidByTokenHash(codeHash);
    expect(consumed).toBeNull();
  });
});
