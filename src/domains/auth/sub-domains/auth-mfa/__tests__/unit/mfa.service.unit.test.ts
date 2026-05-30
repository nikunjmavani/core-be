import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { MfaService } from '@/domains/auth/sub-domains/auth-mfa/mfa.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';

vi.mock('otplib', () => ({
  generateSecret: () => 'TESTSECRET',
  generateURI: () => 'otpauth://totp/core-be:user@example.com?secret=TESTSECRET',
  verify: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  signAccessToken: vi.fn().mockReturnValue('access-token'),
}));

vi.mock('@/shared/utils/auth/global-admin-role.util.js', () => ({
  resolveAccessTokenRoleForUser: vi.fn().mockResolvedValue('USER'),
}));

vi.mock('@/domains/auth/auth.validator.js', () => ({
  validateMfaVerify: (body: unknown) => body,
  validateMfaEnroll: (body: unknown) => body,
  validateMfaLoginVerify: (body: unknown) => body,
}));

vi.mock('@/domains/auth/sub-domains/auth-mfa/mfa-session.js', () => ({
  createMfaSession: vi.fn().mockResolvedValue('session-token'),
  verifyMfaSession: vi.fn().mockResolvedValue({ user_public_id: 'user_public' }),
}));

vi.mock('@/domains/auth/sub-domains/auth-mfa/mfa-recovery-code.repository.js', () => ({
  consumeMfaRecoveryCode: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/shared/utils/security/field-secret-encryption.util.js', () => ({
  encryptFieldSecret: (value: string) => value,
  decryptFieldSecret: (value: string) => value,
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
  status: 'ACTIVE',
  is_email_verified: true,
};

describe('MfaService', () => {
  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
    updateMfaEnabled: vi.fn().mockResolvedValue(undefined),
  } as unknown as UserService;

  const authMethodService = {
    findTotpByUserId: vi.fn(),
    updateAuthMethodLastUsedAt: vi.fn().mockResolvedValue({}),
    createAuthMethodRecord: vi.fn().mockResolvedValue({ id: 99 }),
    listMfaMethodsByUserId: vi.fn().mockResolvedValue([]),
    revokeAuthMethod: vi.fn(),
    findAuthMethodByIdForUser: vi.fn(),
  } as unknown as AuthMethodService;

  const authSessionService = {
    createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  } as unknown as AuthSessionService;

  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  };

  const service = new MfaService(
    userService,
    authMethodService,
    authSessionService,
    redis as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    redis.set.mockResolvedValue('OK');
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
    vi.mocked(authMethodService.findTotpByUserId).mockResolvedValue({
      id: 5,
      encrypted_secret: 'TESTSECRET',
    } as never);
    vi.mocked(userService.updateMfaEnabled).mockResolvedValue(undefined as never);
  });

  it('verifyLoginMfa issues session after valid TOTP', async () => {
    const result = await service.verifyLoginMfa(
      { mfa_session_token: 'token', totp_code: '123456' },
      '127.0.0.1',
    );
    expect(result.access_token).toBe('access-token');
    expect(authSessionService.createSessionForUser).toHaveBeenCalled();
  });

  it('verifyLoginMfa issues session after valid recovery code', async () => {
    const { consumeMfaRecoveryCode } = await import(
      '@/domains/auth/sub-domains/auth-mfa/mfa-recovery-code.repository.js'
    );
    vi.mocked(consumeMfaRecoveryCode).mockResolvedValueOnce(true);

    const result = await service.verifyLoginMfa(
      { mfa_session_token: 'token', recovery_code: 'ABCD-1234' },
      '127.0.0.1',
    );
    expect(result.access_token).toBe('access-token');
    expect(consumeMfaRecoveryCode).toHaveBeenCalledWith(user.id, 'ABCD-1234');
  });

  it('verifyLoginMfa rejects already-used recovery codes', async () => {
    const { consumeMfaRecoveryCode } = await import(
      '@/domains/auth/sub-domains/auth-mfa/mfa-recovery-code.repository.js'
    );
    vi.mocked(consumeMfaRecoveryCode).mockResolvedValueOnce(false);

    await expect(
      service.verifyLoginMfa(
        { mfa_session_token: 'token', recovery_code: 'USED-CODE1' },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verify accepts valid TOTP code', async () => {
    const result = await service.verify('user_public', { code: '123456' });
    expect(result.verified).toBe(true);
    expect(authMethodService.updateAuthMethodLastUsedAt).toHaveBeenCalled();
  });

  it('verify rejects when MFA not enabled', async () => {
    vi.mocked(authMethodService.findTotpByUserId).mockResolvedValue(null);
    await expect(service.verify('user_public', { code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('enroll creates TOTP method', async () => {
    const result = await service.enroll('user_public', { method_type: 'MFA_TOTP' });
    expect(result.secret).toBe('TESTSECRET');
    expect(result.method_id).toBe(99);
    expect(userService.updateMfaEnabled).toHaveBeenCalledWith('user_public', true);
  });

  it('enroll rejects non-TOTP method types', async () => {
    await expect(service.enroll('user_public', { method_type: 'MFA_SMS' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('verifyLoginMfa rejects a replayed TOTP code within its window', async () => {
    redis.set.mockResolvedValueOnce(null);
    await expect(
      service.verifyLoginMfa({ mfa_session_token: 'token', totp_code: '123456' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authSessionService.createSessionForUser).not.toHaveBeenCalled();
  });

  it('verify rejects a replayed TOTP code within its window', async () => {
    redis.set.mockResolvedValueOnce(null);
    await expect(service.verify('user_public', { code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('verifyLoginMfa marks the consumed TOTP code in Redis with NX', async () => {
    await service.verifyLoginMfa({ mfa_session_token: 'token', totp_code: '123456' }, '127.0.0.1');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('mfa:totp:consumed:'),
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
  });

  it('deleteMfa revokes method and disables MFA when last method removed', async () => {
    vi.mocked(authMethodService.findAuthMethodByIdForUser).mockResolvedValue({
      id: 5,
      method_type: 'MFA_TOTP',
    } as never);
    vi.mocked(authMethodService.revokeAuthMethod).mockResolvedValue({ id: 5 } as never);
    vi.mocked(authMethodService.listMfaMethodsByUserId).mockResolvedValue([]);

    await service.deleteMfa('user_public', 5);
    expect(userService.updateMfaEnabled).toHaveBeenCalledWith('user_public', false);
  });

  it('listMfaMethods returns enrolled methods', async () => {
    vi.mocked(authMethodService.listMfaMethodsByUserId).mockResolvedValue([
      { id: 5, method_type: 'MFA_TOTP', last_used_at: null, created_at: new Date() },
    ] as never);
    const methods = await service.listMfaMethods('user_public');
    expect(methods).toHaveLength(1);
  });

  it('verify rejects invalid TOTP codes', async () => {
    const { verify } = await import('otplib');
    vi.mocked(verify).mockResolvedValueOnce({ valid: false } as never);
    await expect(service.verify('user_public', { code: '000000' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('deleteMfa keeps MFA enabled when other methods remain', async () => {
    vi.mocked(authMethodService.findAuthMethodByIdForUser).mockResolvedValue({
      id: 5,
      method_type: 'MFA_TOTP',
    } as never);
    vi.mocked(authMethodService.revokeAuthMethod).mockResolvedValue({ id: 5 } as never);
    vi.mocked(authMethodService.listMfaMethodsByUserId).mockResolvedValue([
      { id: 6, method_type: 'MFA_TOTP' },
    ] as never);

    await service.deleteMfa('user_public', 5);
    expect(userService.updateMfaEnabled).not.toHaveBeenCalledWith('user_public', false);
  });

  it('deleteMfa rejects unknown or non-TOTP methods', async () => {
    vi.mocked(authMethodService.findAuthMethodByIdForUser).mockResolvedValue(null);
    await expect(service.deleteMfa('user_public', 99)).rejects.toBeInstanceOf(UnauthorizedError);

    vi.mocked(authMethodService.findAuthMethodByIdForUser).mockResolvedValue({
      id: 5,
      method_type: 'OAUTH',
    } as never);
    await expect(service.deleteMfa('user_public', 5)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('deleteMfa rejects when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.deleteMfa('missing', 5)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('deleteMfa rejects when revoke fails', async () => {
    vi.mocked(authMethodService.findAuthMethodByIdForUser).mockResolvedValue({
      id: 5,
      method_type: 'MFA_TOTP',
    } as never);
    vi.mocked(authMethodService.revokeAuthMethod).mockRejectedValue(
      new UnauthorizedError('errors:mfaMethodNotFound'),
    );
    await expect(service.deleteMfa('user_public', 5)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verify and listMfaMethods reject when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.verify('missing', { code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(service.listMfaMethods('missing')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('enroll rejects when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.enroll('missing', { method_type: 'MFA_TOTP' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('verify rejects when TOTP secret is missing', async () => {
    vi.mocked(authMethodService.findTotpByUserId).mockResolvedValue({
      id: 5,
      encrypted_secret: null,
    } as never);
    await expect(service.verify('user_public', { code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
