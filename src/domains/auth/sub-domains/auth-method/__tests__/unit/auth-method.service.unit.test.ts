import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import type { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type * as EventBusModule from '@/core/events/event-bus.js';

vi.mock('@/core/events/event-bus.js', async (importOriginal) => {
  const original = await importOriginal<typeof EventBusModule>();
  return {
    ...original,
    eventBus: {
      emit: vi.fn().mockResolvedValue(undefined),
      emitStrict: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('@/shared/utils/security/password.util.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  verifyPassword: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

const user = {
  id: 1,
  public_id: 'user_public',
  email: 'user@example.com',
  password_hash: 'hash',
  is_email_verified: false,
  status: 'ACTIVE',
};

describe('AuthMethodService', () => {
  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
    findByEmail: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    updatePassword: vi.fn().mockResolvedValue(user),
    updateEmailVerified: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const authMethodRepository = {
    listByUserId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 2 }),
    revoke: vi.fn().mockResolvedValue({ id: 2 }),
    revokeAllByUserId: vi.fn().mockResolvedValue(1),
    findByProviderUserId: vi.fn().mockResolvedValue(null),
    findTotpByUserId: vi.fn().mockResolvedValue(null),
    updateLastUsedAt: vi.fn().mockResolvedValue(undefined),
    findByIdForUser: vi.fn().mockResolvedValue(null),
    listMfaByUserId: vi.fn().mockResolvedValue([]),
  } as unknown as AuthMethodRepository;

  const verificationTokenRepository = {
    invalidateAllForUser: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 3 }),
    consumeIfValid: vi.fn(),
    findValidByTokenHash: vi.fn(),
    markUsed: vi.fn(),
  } as unknown as VerificationTokenRepository;

  const authSessionService = {
    revokeAllSessions: vi.fn().mockResolvedValue(undefined),
    revokeAllSessionsExceptCurrent: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthSessionService;

  const service = new AuthMethodService(
    userService,
    authMethodRepository,
    verificationTokenRepository,
    authSessionService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
  });

  it('throws NotFoundError when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.list('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.create('missing', {
        method_type: 'OAUTH',
        provider: 'google',
        provider_user_id: 'gid',
        is_primary: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokeAllForUser throws when user is not found', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.revokeAllForUser('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists and mutates auth methods for user', async () => {
    await service.list('user_public');
    await service.create('user_public', {
      method_type: 'OAUTH',
      provider: 'google',
      provider_user_id: 'gid',
      is_primary: true,
    });
    await service.delete('user_public', 2);
    await service.revokeAllForUser('user_public');
    expect(authMethodRepository.create).toHaveBeenCalled();
  });

  it('forgotPassword creates reset token when user exists', async () => {
    const result = await service.forgotPassword({ email: user.email });
    expect(result.messageKey).toBe('success:passwordResetEmailSent');
    expect(verificationTokenRepository.create).toHaveBeenCalled();
  });

  it('forgotPassword returns success when user unknown', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    const result = await service.forgotPassword({ email: 'missing@example.com' });
    expect(result.messageKey).toBe('success:passwordResetEmailSent');
  });

  it('resetPassword updates password for valid token', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'PASSWORD_RESET',
      user_id: user.id,
    } as never);
    await service.resetPassword({ token: 'reset-token', password: 'NewPassword123!' });
    expect(userService.updatePassword).toHaveBeenCalled();
    expect(authSessionService.revokeAllSessions).toHaveBeenCalledWith(user.public_id);
  });

  it('resetPassword rejects invalid token', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue(null);
    await expect(
      service.resetPassword({ token: 'bad', password: 'NewPassword123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('changePassword verifies current password and revokes other sessions', async () => {
    await service.changePassword(
      'user_public',
      {
        current_password: 'old',
        new_password: 'NewPassword123!',
      },
      { currentAccessToken: 'current-bearer-token' },
    );
    expect(userService.updatePassword).toHaveBeenCalled();
    expect(authSessionService.revokeAllSessionsExceptCurrent).toHaveBeenCalledWith({
      userPublicId: user.public_id,
      currentAccessToken: 'current-bearer-token',
    });
    expect(authSessionService.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('changePassword revokes all sessions when no current token is supplied', async () => {
    await service.changePassword('user_public', {
      current_password: 'old',
      new_password: 'NewPassword123!',
    });
    expect(authSessionService.revokeAllSessionsExceptCurrent).not.toHaveBeenCalled();
    expect(authSessionService.revokeAllSessions).toHaveBeenCalledWith(user.public_id);
  });

  it('changePassword rejects when password auth disabled', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue({
      ...user,
      password_hash: null,
    } as never);
    await expect(
      service.changePassword('user_public', {
        current_password: 'old',
        new_password: 'NewPassword123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyEmail and resendEmailVerification handle verification flow', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'EMAIL_VERIFICATION',
      user_id: user.id,
    } as never);
    const verified = await service.verifyEmail({ token: 'verify-token' });
    expect(verified.messageKey).toBe('success:emailVerified');

    const resent = await service.resendEmailVerification('user_public');
    expect(resent.messageKey).toBe('success:verificationEmailSent');
  });

  it('resendEmailVerification returns already verified message', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue({
      ...user,
      is_email_verified: true,
    } as never);
    const result = await service.resendEmailVerification('user_public');
    expect(result.messageKey).toBe('success:emailAlreadyVerified');
  });

  it('forgotPassword rejects disposable email', async () => {
    const emailUtil = await import('@/shared/utils/text/email.util.js');
    vi.mocked(emailUtil.isDisposableEmailBlocked).mockReturnValueOnce(true);
    await expect(service.forgotPassword({ email: 'bad@temp.com' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('delete throws when auth method is not found', async () => {
    vi.mocked(authMethodRepository.revoke).mockResolvedValue(null);
    await expect(service.delete('user_public', 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resetPassword rejects wrong token type and missing user', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'EMAIL_VERIFICATION',
      user_id: user.id,
    } as never);
    await expect(
      service.resetPassword({ token: 'reset-token', password: 'NewPassword123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'PASSWORD_RESET',
      user_id: user.id,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue(null);
    await expect(
      service.resetPassword({ token: 'reset-token', password: 'NewPassword123!' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changePassword rejects incorrect current password', async () => {
    const passwordUtil = await import('@/shared/utils/security/password.util.js');
    vi.mocked(passwordUtil.verifyPassword).mockResolvedValueOnce({
      valid: false,
      needsRehash: false,
    });
    await expect(
      service.changePassword('user_public', {
        current_password: 'wrong',
        new_password: 'NewPassword123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyEmail throws when user record is missing after token consume', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'EMAIL_VERIFICATION',
      user_id: user.id,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue(null);
    await expect(service.verifyEmail({ token: 'verify-token' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('verifyEmail rejects invalid token type', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue({
      token_type: 'PASSWORD_RESET',
      user_id: user.id,
    } as never);
    await expect(service.verifyEmail({ token: 'verify-token' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('delete throws NotFoundError when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.delete('missing', 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changePassword throws NotFoundError when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(
      service.changePassword('missing', {
        current_password: 'old',
        new_password: 'NewPassword123!',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resendEmailVerification throws when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.resendEmailVerification('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resetPassword rejects when token record is missing', async () => {
    vi.mocked(verificationTokenRepository.consumeIfValid).mockResolvedValue(null);
    await expect(
      service.resetPassword({ token: 'missing', password: 'NewPassword123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('delegates repository helpers and links OAuth when missing', async () => {
    const oauthData = {
      user_id: user.id,
      method_type: 'OAUTH',
      provider: 'google',
      provider_user_id: 'gid',
      is_primary: true,
    } as const;

    vi.mocked(authMethodRepository.findByProviderUserId).mockResolvedValue(null);
    await service.findByProviderUserId('google', 'gid');
    await service.linkOAuthProviderIfMissing({ ownerPublicId: user.public_id, data: oauthData });
    expect(authMethodRepository.create).toHaveBeenCalledWith(oauthData);

    vi.mocked(authMethodRepository.findByProviderUserId).mockResolvedValue({ id: 9 } as never);
    await service.linkOAuthProviderIfMissing({ ownerPublicId: user.public_id, data: oauthData });
    expect(authMethodRepository.create).toHaveBeenCalledTimes(1);

    await service.linkOAuthProviderIfMissing({
      ownerPublicId: user.public_id,
      data: {
        user_id: user.id,
        method_type: 'PASSWORD',
      },
    });
    await service.findTotpByUserId(user.id);
    await service.createAuthMethodRecord(oauthData);
    await service.updateAuthMethodLastUsedAt(2, user.id);
    await service.findAuthMethodByIdForUser(2, user.id);
    await service.listMfaMethodsByUserId(user.id);
    vi.mocked(authMethodRepository.revoke).mockResolvedValue({ id: 2 } as never);
    await service.revokeAuthMethod(2, user.id);
    expect(authMethodRepository.findTotpByUserId).toHaveBeenCalled();
    expect(authMethodRepository.updateLastUsedAt).toHaveBeenCalled();
    expect(authMethodRepository.findByIdForUser).toHaveBeenCalled();
    expect(authMethodRepository.listMfaByUserId).toHaveBeenCalled();
    expect(authMethodRepository.revoke).toHaveBeenCalled();
  });
});
