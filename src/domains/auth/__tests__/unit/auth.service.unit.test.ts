import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { AuthService } from '@/domains/auth/auth.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/mfa.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/shared/utils/security/password.util.js', () => ({
  verifyPassword: vi.fn().mockResolvedValue({ valid: true, needsRehash: false }),
  hashPassword: vi.fn().mockResolvedValue('new-hash'),
  DUMMY_ARGON2_HASH: '$argon2id$dummy',
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  signAccessToken: vi.fn().mockResolvedValue('jwt-access-token'),
}));

vi.mock('@/shared/utils/auth/global-admin-role.util.js', () => ({
  resolveAccessTokenRoleForUser: vi.fn().mockResolvedValue('USER'),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
  withSessionPublicIdDatabaseContext: vi.fn(
    (_sessionPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
  withSessionTokenHashDatabaseContext: vi.fn(
    (_tokenHash: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

const user = {
  id: 1,
  public_id: generatePublicId(),
  email: 'user@example.com',
  password_hash: 'hash',
  failed_login_count: 0,
  account_locked_until: null,
  status: 'ACTIVE',
  is_mfa_enabled: false,
};

describe('AuthService', () => {
  const userService = {
    findByEmail: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    updateLoginAttempt: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const authSessionService = {
    createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
    revokeSessionByAccessToken: vi.fn().mockResolvedValue(undefined),
    findActiveSessionByPublicId: vi.fn().mockResolvedValue({
      public_id: 'session_public',
      user_id: 1,
      expires_at: new Date(Date.now() + 86_400_000),
      revoked_at: null,
    }),
    rotateSessionTokenHash: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthSessionService;

  const mfaService = {
    createMfaSession: vi.fn().mockResolvedValue('mfa_session_token'),
  } as unknown as MfaService;

  const organizationSettingsService = {
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  } as unknown as OrganizationSettingsService;

  const service = new AuthService(
    userService,
    authSessionService,
    mfaService,
    organizationSettingsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.findByEmail).mockResolvedValue(user as never);
    vi.mocked(organizationSettingsService.userHasOrganizationRequiringMfa).mockResolvedValue(false);
  });

  it('login returns mfa_required when user has MFA enabled', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      is_mfa_enabled: true,
    } as never);
    const result = await service.login(
      { email: user.email, password: 'ValidPassword12!' },
      '127.0.0.1',
    );
    expect(result).toEqual({
      mfa_required: true,
      mfa_session_token: 'mfa_session_token',
    });
    expect(mfaService.createMfaSession).toHaveBeenCalledWith(user.public_id);
    expect(authSessionService.createSessionForUser).not.toHaveBeenCalled();
  });

  it('login returns mfa_required when an organization requires MFA', async () => {
    vi.mocked(organizationSettingsService.userHasOrganizationRequiringMfa).mockResolvedValue(true);
    const result = await service.login(
      { email: user.email, password: 'ValidPassword12!' },
      '127.0.0.1',
    );
    expect(result).toEqual({
      mfa_required: true,
      mfa_session_token: 'mfa_session_token',
    });
  });

  it('login returns access token and session id', async () => {
    const result = await service.login(
      { email: user.email, password: 'ValidPassword12!' },
      '127.0.0.1',
      'agent',
    );
    expect('access_token' in result && result.access_token).toBe('jwt-access-token');
    expect(authSessionService.createSessionForUser).toHaveBeenCalled();
  });

  it('login rejects unknown user', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@y.com', password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('runs a dummy password verification for unknown emails to equalize login timing (#23)', async () => {
    const { verifyPassword, DUMMY_ARGON2_HASH } = await import(
      '@/shared/utils/security/password.util.js'
    );
    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    await expect(
      service.login({ email: 'unknown@example.com', password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifyPassword).toHaveBeenCalledWith('WrongPassword1!', DUMMY_ARGON2_HASH);
  });

  it('login rejects locked account', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      account_locked_until: new Date(Date.now() + 60_000),
    } as never);
    await expect(
      service.login({ email: user.email, password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('allows login when account lock has expired', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      account_locked_until: new Date(Date.now() - 60_000),
    } as never);
    const result = await service.login(
      { email: user.email, password: 'ValidPassword12!' },
      '127.0.0.1',
    );
    expect('access_token' in result && result.access_token).toBe('jwt-access-token');
  });

  it('logout revokes session by token hash', async () => {
    await service.logout('bearer-token');
    expect(authSessionService.revokeSessionByAccessToken).toHaveBeenCalled();
  });

  it('refreshToken issues new jwt for valid session', async () => {
    const result = await service.refreshToken('session_public');
    expect(result.access_token).toBe('jwt-access-token');
  });

  it('increments failed attempts without lockout below the maximum threshold', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      failed_login_count: 3,
    } as never);
    const { verifyPassword } = await import('@/shared/utils/security/password.util.js');
    vi.mocked(verifyPassword).mockResolvedValueOnce({ valid: false, needsRehash: false });

    await expect(
      service.login({ email: user.email, password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(userService.updateLoginAttempt).toHaveBeenCalledWith(user.public_id, 4, null);
  });

  it('login increments failed attempts on bad password', async () => {
    const { verifyPassword } = await import('@/shared/utils/security/password.util.js');
    vi.mocked(verifyPassword).mockResolvedValueOnce({ valid: false, needsRehash: false });
    await expect(
      service.login({ email: user.email, password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(userService.updateLoginAttempt).toHaveBeenCalled();
  });

  it('refreshToken rejects missing session', async () => {
    vi.mocked(authSessionService.findActiveSessionByPublicId).mockResolvedValue(null);
    await expect(service.refreshToken('missing')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refreshToken rejects expired sessions and inactive users', async () => {
    vi.mocked(authSessionService.findActiveSessionByPublicId).mockResolvedValue({
      public_id: 'session_public',
      user_id: 1,
      expires_at: new Date(Date.now() - 1000),
      revoked_at: null,
    } as never);
    await expect(service.refreshToken('session_public')).rejects.toBeInstanceOf(UnauthorizedError);

    vi.mocked(authSessionService.findActiveSessionByPublicId).mockResolvedValue({
      public_id: 'session_public',
      user_id: 1,
      expires_at: new Date(Date.now() + 86_400_000),
      revoked_at: null,
    } as never);
    vi.mocked(userService.findById).mockResolvedValue({ ...user, status: 'SUSPENDED' } as never);
    await expect(service.refreshToken('session_public')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('login rehashes password when verifyPassword reports needsRehash', async () => {
    const { verifyPassword } = await import('@/shared/utils/security/password.util.js');
    vi.mocked(verifyPassword).mockResolvedValueOnce({ valid: true, needsRehash: true });
    await service.login({ email: user.email, password: 'ValidPassword12!' }, '127.0.0.1', 'agent');
    expect(userService.updatePassword).toHaveBeenCalled();
  });

  it('login locks account after the maximum failed attempts', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      failed_login_count: 9,
    } as never);
    const { verifyPassword } = await import('@/shared/utils/security/password.util.js');
    vi.mocked(verifyPassword).mockResolvedValueOnce({ valid: false, needsRehash: false });

    await expect(
      service.login({ email: user.email, password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(userService.updateLoginAttempt).toHaveBeenCalledWith(
      user.public_id,
      10,
      expect.any(Date),
    );
  });

  it('login rejects disposable email addresses', async () => {
    const emailUtil = await import('@/shared/utils/text/email.util.js');
    vi.mocked(emailUtil.isDisposableEmailBlocked).mockReturnValueOnce(true);
    await expect(
      service.login({ email: 'temp@mailinator.com', password: 'ValidPassword12!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('logout rejects unknown or already revoked tokens', async () => {
    vi.mocked(authSessionService.revokeSessionByAccessToken).mockRejectedValue(
      new UnauthorizedError('errors:invalidOrRevokedToken'),
    );
    await expect(service.logout('missing-token')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('login does not reset failed login count when count is already zero', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      failed_login_count: 0,
    } as never);
    await service.login({ email: user.email, password: 'ValidPassword12!' }, '127.0.0.1');
    expect(userService.updateLoginAttempt).not.toHaveBeenCalled();
  });

  it('login rejects users without password authentication enabled', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      password_hash: null,
    } as never);
    await expect(
      service.login({ email: user.email, password: 'ValidPassword12!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refreshToken rejects when user record is missing', async () => {
    vi.mocked(userService.findById).mockResolvedValue(null);
    await expect(service.refreshToken('session_public')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('login resets failed login count after successful authentication', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      failed_login_count: 4,
    } as never);
    await service.login({ email: user.email, password: 'ValidPassword12!' }, '127.0.0.1');
    expect(userService.updateLoginAttempt).toHaveBeenCalledWith(user.public_id, 0, null);
  });

  it('login treats null failed_login_count as zero on bad password', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      ...user,
      failed_login_count: null,
    } as never);
    const { verifyPassword } = await import('@/shared/utils/security/password.util.js');
    vi.mocked(verifyPassword).mockResolvedValueOnce({ valid: false, needsRehash: false });

    await expect(
      service.login({ email: user.email, password: 'WrongPassword1!' }, '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(userService.updateLoginAttempt).toHaveBeenCalledWith(user.public_id, 1, null);
  });
});
