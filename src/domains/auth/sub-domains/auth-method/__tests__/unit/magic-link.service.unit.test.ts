import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MagicLinkService } from '@/domains/auth/sub-domains/auth-method/magic-link.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';
import type { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token.repository.js';

vi.mock('@/core/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn().mockResolvedValue(undefined) },
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

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { NODE_ENV: 'test', SESSION_MAX_AGE_DAYS: 7 },
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  signAccessToken: vi.fn().mockReturnValue('jwt-token'),
}));

vi.mock('@/shared/utils/auth/global-admin-role.util.js', () => ({
  resolveAccessTokenRoleForUser: vi.fn().mockResolvedValue('USER'),
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

  const authSessionRepository = {
    create: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  } as unknown as AuthSessionRepository;

  const verificationTokenRepository = {
    create: vi.fn().mockResolvedValue(undefined),
    consumeIfValid: vi.fn(),
    findValidByTokenHash: vi.fn(),
    markUsed: vi.fn().mockResolvedValue(undefined),
  } as unknown as VerificationTokenRepository;

  const service = new MagicLinkService(
    userService,
    authSessionRepository,
    verificationTokenRepository,
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

  it('send creates token and emits event for existing user', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    const result = await service.send({ email: user.email });
    expect(verificationTokenRepository.create).toHaveBeenCalled();
    expect(result.token).toBeDefined();
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

    expect(result.access_token).toBe('jwt-token');
    expect(result.session_public_id).toBe('session_public');
    expect(authSessionRepository.create).toHaveBeenCalled();
  });

  it('verify rejects when user record is missing after token consume', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'MAGIC_LINK',
      user_id: user.id,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue(null);
    await expect(service.verify({ token: 'raw' }, '127.0.0.1')).rejects.toThrow();
  });

  it('send omits raw token in production environment', async () => {
    const { env } = await import('@/shared/config/env.config.js');
    const originalNodeEnvironment = env.NODE_ENV;
    Object.assign(env, { NODE_ENV: 'production' });
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);

    const result = await service.send({ email: user.email });

    expect(result.token).toBeUndefined();
    Object.assign(env, { NODE_ENV: originalNodeEnvironment });
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
