import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { UserService } from '@/domains/user/user.service.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import { MagicLinkService } from '@/domains/auth/sub-domains/auth-method/magic-link.service.js';
import { createTestUser } from '@/tests/factories/user.factory.js';

/**
 * audit-#12: magic-link verify must keep the one-time token consumption and the downstream
 * first-factor completion (session creation) in ONE atomic transaction. A failure after
 * consumption previously burned a valid single-use link; the pinned transaction now rolls the
 * consumption back so the link stays redeemable.
 */
describe('MagicLinkService.verify (one-time-token atomicity — audit-#12)', () => {
  const userRepository = new UserRepository();
  const userService = new UserService(userRepository, {} as never);
  const verificationTokenRepository = new VerificationTokenRepository();

  const organizationSettingsServiceStub = {
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  };

  function buildService(authSessionServiceStub: unknown): MagicLinkService {
    return new MagicLinkService(
      userService,
      verificationTokenRepository,
      organizationSettingsServiceStub as never,
      { createMfaSession: vi.fn() } as never,
      authSessionServiceStub as never,
    );
  }

  async function seedMagicLinkToken(userId: number, email: string) {
    const rawToken = `magic-${userId}-${Date.now()}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await verificationTokenRepository.create(
      'MAGIC_LINK',
      userId,
      email,
      tokenHash,
      new Date(Date.now() + 900_000),
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

  it('keeps the link redeemable when session creation fails after consumption', async () => {
    const user = await createTestUser({ email: 'magic-rollback@example.com' });
    const { rawToken, tokenHash } = await seedMagicLinkToken(user.id, user.email);

    const service = buildService({
      createSessionForUser: vi.fn().mockRejectedValue(new Error('forced session failure')),
    });

    await expect(service.verify({ token: rawToken }, '127.0.0.1')).rejects.toThrow(
      'forced session failure',
    );

    // Rollback proven: the token was NOT permanently consumed and remains valid for a retry.
    const stillValid = await verificationTokenRepository.findValidByTokenHash(tokenHash);
    expect(stillValid).not.toBeNull();
  });

  it('consumes the link and issues a session on the happy path', async () => {
    const user = await createTestUser({ email: 'magic-happy@example.com' });
    const { rawToken, tokenHash } = await seedMagicLinkToken(user.id, user.email);

    const service = buildService({
      createSessionForUser: vi.fn().mockResolvedValue({
        public_id: 'session_pub',
        refresh_secret: 'refresh_secret',
      }),
    });

    const result = await service.verify({ token: rawToken }, '127.0.0.1');
    expect('access_token' in result && result.access_token).toBeTruthy();

    // The token is now consumed (single-use enforced).
    const consumed = await verificationTokenRepository.findValidByTokenHash(tokenHash);
    expect(consumed).toBeNull();
  });
});
