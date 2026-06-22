import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { MagicLinkService } from '@/domains/auth/sub-domains/auth-method/magic-link.service.js';
import type { UserService } from '@/domains/user/user.service.js';

vi.mock('@/domains/auth/shared/complete-first-factor-auth.js', () => ({
  completeFirstFactorAuth: vi.fn().mockResolvedValue({
    access_token: 'jwt-token',
    session_public_id: 'session_public',
    session_refresh_secret: 'refresh_secret',
  }),
}));

// send/verify wrap their writes in withTransaction + runWithPinnedDatabaseHandle; invoke the
// callbacks directly so the unit test exercises the flow without a real database/transaction.
vi.mock('@/infrastructure/database/transaction.js', () => ({
  withTransaction: vi.fn((callback: (transaction: unknown) => unknown) => callback({})),
}));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  runWithPinnedDatabaseHandle: vi.fn((_handle: unknown, callback: () => unknown) => callback()),
  getRequestDatabase: vi.fn(() => ({})),
}));

vi.mock('@/core/events/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    emitStrict: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/shared/utils/security/anti-enumeration.util.js', () => ({
  enforceMinimumDuration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/config/env.config.js', () => {
  const env = {
    NODE_ENV: 'test',
    AUTH_SESSION_MAX_AGE_DAYS: 7,
    PERSONAL_ORGANIZATION_ENABLED: false,
  };
  return { env, getEnv: () => env };
});

// MagicLinkService imports `redisConnection` (default constructor dep) — stub the client module so a
// real Redis connection (and the env-config read in resolveRedisKeyPrefix at its module load) is
// never constructed in this unit test. The constructor receives an explicit `redis` stub below.
vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {},
}));

vi.mock('@/domains/tenancy/sub-domains/organization/organization-provisioning.js', () => ({
  provisionPersonalOrganization: vi.fn().mockResolvedValue(undefined),
}));

import { eventBus } from '@/core/events/event-bus.js';
import { env } from '@/shared/config/env.config.js';
import { AUTH_EVENT } from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import { completeFirstFactorAuth } from '@/domains/auth/shared/complete-first-factor-auth.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';

const user = {
  id: 1,
  public_id: 'abcdefghijklmnopqrstu',
  email: 'user@example.com',
  status: 'ACTIVE',
  is_email_verified: false,
  is_mfa_enabled: false,
  deleted_at: null,
};

describe('MagicLinkService', () => {
  const userService = {
    findByEmail: vi.fn(),
    createForMagicLink: vi.fn(),
    updateEmailVerified: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const organizationSettingsService = {
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  } as unknown as OrganizationSettingsService;

  const mfaService = {
    createMfaSession: vi.fn(),
  } as unknown as MfaService;

  const authSessionService = {
    createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  } as unknown as AuthSessionService;

  const authMethodService = {
    createMagicLinkMethod: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthMethodService;

  const verificationTokenRepository = {
    create: vi.fn().mockResolvedValue(undefined),
    consumeOtpForUser: vi.fn(),
    findValidByTokenHash: vi.fn(),
    invalidateAllForUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as VerificationTokenRepository;

  // incrementWithExpiryOnFirst (real util) calls redis.eval and returns the attempt count;
  // 1 = under the cap by default, del clears it on success.
  const redis = {
    eval: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(0),
  } as unknown as Redis;

  const service = new MagicLinkService(
    userService,
    verificationTokenRepository,
    organizationSettingsService,
    mfaService,
    authSessionService,
    authMethodService,
    redis,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.eval).mockResolvedValue(1);
  });

  it('send auto-signs-up an unknown email then issues a code', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    vi.mocked(userService.createForMagicLink).mockResolvedValue(user as never);

    const result = await service.send({ email: 'new-user@example.com' });

    expect(userService.createForMagicLink).toHaveBeenCalledWith({ email: 'new-user@example.com' });
    expect(authMethodService.createMagicLinkMethod).toHaveBeenCalledWith(user.id, user.public_id);
    expect(verificationTokenRepository.create).toHaveBeenCalled();
    expect(vi.mocked(eventBus.emitStrict)).toHaveBeenCalledTimes(1);
    expect(result.messageKey).toBe('success:magicLinkEmailSent');
  });

  it('send falls back to the existing user when the create races a unique violation', async () => {
    vi.mocked(userService.findByEmail)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user as never);
    vi.mocked(userService.createForMagicLink).mockRejectedValue({ code: '23505' });

    const result = await service.send({ email: user.email });

    // No 409 — magic-link is auto-signup; it converges on the existing user and still issues a code.
    expect(result.messageKey).toBe('success:magicLinkEmailSent');
    expect(verificationTokenRepository.create).toHaveBeenCalled();
    expect(vi.mocked(eventBus.emitStrict)).toHaveBeenCalledTimes(1);
  });

  it('send issues a code for an existing user without creating one', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);

    const result = await service.send({ email: user.email });

    expect(userService.createForMagicLink).not.toHaveBeenCalled();
    expect(verificationTokenRepository.invalidateAllForUser).toHaveBeenCalledWith(
      user.id,
      'MAGIC_LINK',
    );
    expect(verificationTokenRepository.create).toHaveBeenCalled();
    // Raw code never leaves via the result — only via the event payload.
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('otp_code');
    const emittedEvent = vi.mocked(eventBus.emitStrict).mock.calls[0]?.[0];
    expect(emittedEvent?.type).toBe(AUTH_EVENT.MAGIC_LINK_REQUESTED);
    const emittedPayload = emittedEvent?.payload as { otp_code: string };
    expect(emittedPayload.otp_code).toMatch(/^\d{6}$/);
  });

  it('send resets the per-user verify-attempt cap so a fresh code restores the budget', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);

    await service.send({ email: user.email });

    // Issuing a new code clears the attempt counter keyed by the resolved user id, so an attacker who
    // burned the cap against the prior code cannot keep the legitimate owner locked out.
    expect(redis.del).toHaveBeenCalledWith(`auth:magic_link_otp_verify_attempts:${user.id}`);
  });

  it('send enforces a constant-time floor on both account-existence branches', async () => {
    const { enforceMinimumDuration } = await import(
      '@/shared/utils/security/anti-enumeration.util.js'
    );
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    vi.mocked(userService.createForMagicLink).mockResolvedValue(user as never);
    await service.send({ email: 'missing@example.com' });
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    await service.send({ email: user.email });
    // Both the new- and existing-account paths run the floor so latency cannot be an oracle.
    expect(vi.mocked(enforceMinimumDuration)).toHaveBeenCalledTimes(2);
  });

  it('send rejects disposable email addresses', async () => {
    const emailUtil = await import('@/shared/utils/text/email.util.js');
    vi.mocked(emailUtil.isDisposableEmailBlocked).mockReturnValueOnce(true);
    await expect(service.send({ email: 'temp@mailinator.com' })).rejects.toThrow();
    expect(userService.createForMagicLink).not.toHaveBeenCalled();
  });

  it('verify creates a session and marks the email verified for a valid code', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    vi.mocked(verificationTokenRepository.consumeOtpForUser).mockResolvedValue({
      token_type: 'MAGIC_LINK',
      user_id: user.id,
    } as never);

    const result = await service.verify(
      { email: user.email, code: '123456' },
      '127.0.0.1',
      'vitest',
    );
    if (!('access_token' in result)) throw new Error('expected access token result');

    expect(verificationTokenRepository.consumeOtpForUser).toHaveBeenCalledWith(
      user.id,
      'MAGIC_LINK',
      expect.any(String),
    );
    // The code proves email control, so an unverified user is flipped to verified.
    expect(userService.updateEmailVerified).toHaveBeenCalledWith(user.public_id);
    expect(result.access_token).toBe('jwt-token');
    expect(redis.del).toHaveBeenCalled();
  });

  it('verify rejects an unknown email without consuming a code', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    await expect(
      service.verify({ email: 'missing@example.com', code: '123456' }, '127.0.0.1'),
    ).rejects.toThrow();
    expect(verificationTokenRepository.consumeOtpForUser).not.toHaveBeenCalled();
  });

  it('verify rejects once the per-user attempt cap is exceeded', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    vi.mocked(redis.eval).mockResolvedValueOnce(99);
    await expect(
      service.verify({ email: user.email, code: '123456' }, '127.0.0.1'),
    ).rejects.toThrow();
    expect(verificationTokenRepository.consumeOtpForUser).not.toHaveBeenCalled();
  });

  it('verify rejects a wrong or expired code', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    vi.mocked(verificationTokenRepository.consumeOtpForUser).mockResolvedValue(null);
    await expect(
      service.verify({ email: user.email, code: '000000' }, '127.0.0.1'),
    ).rejects.toThrow();
  });

  it('verify propagates a downstream session/MFA failure so the code consume rolls back', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    vi.mocked(verificationTokenRepository.consumeOtpForUser).mockResolvedValue({
      token_type: 'MAGIC_LINK',
      user_id: user.id,
    } as never);
    vi.mocked(completeFirstFactorAuth).mockRejectedValueOnce(new Error('session insert failed'));

    await expect(
      service.verify({ email: user.email, code: '123456' }, '127.0.0.1'),
    ).rejects.toThrow('session insert failed');
    // consume + completion ran in the same transaction, so a real DB rolls the consume
    // back and the code stays usable for a retry.
    expect(verificationTokenRepository.consumeOtpForUser).toHaveBeenCalled();
    // The success-only attempt-counter clear must NOT run when verify throws.
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('verify provisions the personal org on the first verification (claims a bare invited account)', async () => {
    env.PERSONAL_ORGANIZATION_ENABLED = true;
    try {
      vi.mocked(userService.findByEmail).mockResolvedValue({
        ...user,
        is_email_verified: false,
      } as never);
      vi.mocked(verificationTokenRepository.consumeOtpForUser).mockResolvedValue({
        token_type: 'MAGIC_LINK',
        user_id: user.id,
      } as never);

      await service.verify({ email: user.email, code: '123456' }, '127.0.0.1', 'vitest');

      // A bare invited placeholder is created without a personal org; the first magic-link
      // verification provisions it post-commit (idempotent), at parity with signup / OAuth.
      expect(vi.mocked(provisionPersonalOrganization)).toHaveBeenCalledWith(user.id);
    } finally {
      env.PERSONAL_ORGANIZATION_ENABLED = false;
    }
  });

  it('verify does not re-provision a personal org for an already-verified returning user', async () => {
    env.PERSONAL_ORGANIZATION_ENABLED = true;
    try {
      vi.mocked(userService.findByEmail).mockResolvedValue({
        ...user,
        is_email_verified: true,
      } as never);
      vi.mocked(verificationTokenRepository.consumeOtpForUser).mockResolvedValue({
        token_type: 'MAGIC_LINK',
        user_id: user.id,
      } as never);

      await service.verify({ email: user.email, code: '123456' }, '127.0.0.1', 'vitest');

      // Already verified → not a first verification → no provisioning churn on every magic-link login.
      expect(vi.mocked(provisionPersonalOrganization)).not.toHaveBeenCalled();
    } finally {
      env.PERSONAL_ORGANIZATION_ENABLED = false;
    }
  });

  it('does not provision a personal org in team-only mode (env flag off)', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    vi.mocked(userService.createForMagicLink).mockResolvedValue(user as never);
    await service.send({ email: 'team-only@example.com' });
    expect(vi.mocked(provisionPersonalOrganization)).not.toHaveBeenCalled();
  });
});
