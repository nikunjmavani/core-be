import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MagicLinkService } from '@/domains/auth/sub-domains/auth-method/magic-link.service.js';
import type { UserService } from '@/domains/user/user.service.js';
vi.mock('@/domains/auth/shared/complete-first-factor-auth.js', () => ({
  completeFirstFactorAuth: vi.fn().mockResolvedValue({
    access_token: 'jwt-token',
    session_public_id: 'session_public',
  }),
}));

import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';

vi.mock('@/core/events/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    emitStrict: vi.fn().mockResolvedValue(undefined),
  },
  buildDomainEvent: (
    type: string,
    payload: unknown,
    options?: { timestamp?: Date; requestId?: string },
  ) => ({
    type,
    payload,
    timestamp: options?.timestamp ?? new Date(),
    ...(options?.requestId !== undefined ? { requestId: options.requestId } : {}),
  }),
}));

import { eventBus } from '@/core/events/event-bus.js';
import { AUTH_EVENT } from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/shared/utils/security/anti-enumeration.util.js', () => ({
  enforceMinimumDuration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { NODE_ENV: 'test', AUTH_SESSION_MAX_AGE_DAYS: 7 },
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  signAccessToken: vi.fn().mockReturnValue('jwt-token'),
}));

vi.mock('@/shared/utils/auth/global-admin-role.util.js', () => ({
  resolveAccessTokenRoleForUser: vi.fn().mockResolvedValue('USER'),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

const user = {
  id: 1,
  public_id: 'abcdefghijklmnopqrstu',
  email: 'user@example.com',
  deleted_at: null,
};

describe('MagicLinkService', () => {
  const userService = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
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

  const verificationTokenRepository = {
    create: vi.fn().mockResolvedValue(undefined),
    consumeIfValid: vi.fn(),
    findValidByTokenHash: vi.fn(),
    markUsed: vi.fn().mockResolvedValue(undefined),
    invalidateAllForUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as VerificationTokenRepository;

  const service = new MagicLinkService(
    userService,
    verificationTokenRepository,
    organizationSettingsService,
    mfaService,
    authSessionService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('send returns generic success when user does not exist', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    const result = await service.send({ email: 'missing@example.com' });
    expect(result.messageKey).toBe('success:magicLinkEmailSent');
    expect(verificationTokenRepository.create).not.toHaveBeenCalled();
  });

  it('send enforces a constant-time floor on both account-existence branches', async () => {
    const { enforceMinimumDuration } = await import(
      '@/shared/utils/security/anti-enumeration.util.js'
    );
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    await service.send({ email: 'missing@example.com' });
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    await service.send({ email: user.email });
    // Both the unknown- and known-account paths run the floor so latency cannot be an oracle.
    expect(vi.mocked(enforceMinimumDuration)).toHaveBeenCalledTimes(2);
  });

  it('send creates token and emits event for existing user', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    const result = await service.send({ email: user.email });
    expect(verificationTokenRepository.invalidateAllForUser).toHaveBeenCalledWith(
      user.id,
      'MAGIC_LINK',
    );
    expect(verificationTokenRepository.create).toHaveBeenCalled();
    /** Raw token never leaves via the result — only via the event payload. */
    expect(result).not.toHaveProperty('token');
    expect(vi.mocked(eventBus.emitStrict)).toHaveBeenCalledTimes(1);
    const emittedEvent = vi.mocked(eventBus.emitStrict).mock.calls[0]?.[0];
    expect(emittedEvent?.type).toBe(AUTH_EVENT.MAGIC_LINK_REQUESTED);
    const emittedPayload = emittedEvent?.payload as { magic_link_token: string };
    expect(emittedPayload.magic_link_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('send rejects disposable email addresses', async () => {
    const emailUtil = await import('@/shared/utils/text/email.util.js');
    vi.mocked(emailUtil.isDisposableEmailBlocked).mockReturnValueOnce(true);
    await expect(service.send({ email: 'temp@mailinator.com' })).rejects.toThrow();
  });

  it('verify creates session for valid magic link token', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'MAGIC_LINK',
      user_id: user.id,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue({
      ...user,
      status: 'ACTIVE',
    } as never);

    const result = await service.verify({ token: 'raw-magic-token' }, '127.0.0.1', 'vitest');
    if (!('access_token' in result)) throw new Error('expected access token result');

    expect(result.access_token).toBe('jwt-token');
    expect(result.session_public_id).toBe('session_public');
  });

  it('verify rejects when user record is missing after token consume', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'MAGIC_LINK',
      user_id: user.id,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue(null);
    await expect(service.verify({ token: 'raw' }, '127.0.0.1')).rejects.toThrow();
  });

  it('verify rejects invalid or expired magic link tokens', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue(null);
    await expect(service.verify({ token: 'bad' }, '127.0.0.1')).rejects.toThrow();

    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'PASSWORD_RESET',
      user_id: user.id,
    } as never);
    await expect(service.verify({ token: 'wrong-type' }, '127.0.0.1')).rejects.toThrow();
  });
});
