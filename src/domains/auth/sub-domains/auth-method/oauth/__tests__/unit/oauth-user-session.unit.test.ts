import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenError } from '@/shared/errors/index.js';
import { completeOAuthUserSession } from '@/domains/auth/sub-domains/auth-method/oauth/oauth-user-session.js';

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn(() => false),
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  signAccessToken: vi.fn().mockResolvedValue('access-token'),
}));

describe('completeOAuthUserSession', () => {
  const userService = {
    findByEmail: vi.fn().mockResolvedValue(null),
    createFromOAuth: vi.fn().mockResolvedValue({
      id: 1,
      public_id: 'user_public',
      email: 'new@example.com',
      status: 'ACTIVE',
      is_email_verified: true,
    }),
  };
  const authMethodService = {
    linkOAuthProviderIfMissing: vi.fn().mockResolvedValue(undefined),
    findByProviderUserId: vi.fn().mockResolvedValue(null),
  };
  const authSessionService = {
    createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  };

  function callCompleteOAuthUserSession() {
    return completeOAuthUserSession({
      userService: userService as never,
      authMethodService: authMethodService as never,
      authSessionService: authSessionService as never,
      provider: 'google',
      profile: {
        email: 'victim@example.com',
        provider_user_id: 'google-1',
      },
      ipAddress: '127.0.0.1',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    userService.findByEmail.mockResolvedValue(null);
    authMethodService.findByProviderUserId.mockResolvedValue(null);
  });

  it('blocks OAuth signup when disposable email is not allowed', async () => {
    const { isDisposableEmailBlocked } = await import('@/shared/utils/text/email.util.js');
    vi.mocked(isDisposableEmailBlocked).mockReturnValueOnce(true);

    await expect(
      completeOAuthUserSession({
        userService: userService as never,
        authMethodService: authMethodService as never,
        authSessionService: authSessionService as never,
        provider: 'google',
        profile: {
          email: 'test@yopmail.com',
          provider_user_id: 'google-1',
        },
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(userService.createFromOAuth).not.toHaveBeenCalled();
  });

  it('blocks find-or-link into a pre-existing account whose email is unverified', async () => {
    userService.findByEmail.mockResolvedValue({
      id: 42,
      public_id: 'victim_public',
      email: 'victim@example.com',
      status: 'ACTIVE',
      is_email_verified: false,
    });

    const error = await callCompleteOAuthUserSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ messageKey: 'errors:oauthLinkRequiresVerifiedAccount' });
    expect(authMethodService.linkOAuthProviderIfMissing).not.toHaveBeenCalled();
    expect(authSessionService.createSessionForUser).not.toHaveBeenCalled();
  });

  it('auto-links into a pre-existing account whose email is already verified', async () => {
    userService.findByEmail.mockResolvedValue({
      id: 42,
      public_id: 'verified_public',
      email: 'victim@example.com',
      status: 'ACTIVE',
      is_email_verified: true,
    });

    const result = await callCompleteOAuthUserSession();

    expect(result.session_public_id).toBe('session_public');
    expect(authMethodService.linkOAuthProviderIfMissing).toHaveBeenCalledTimes(1);
    expect(userService.createFromOAuth).not.toHaveBeenCalled();
  });

  it('issues a session for a returning OAuth user even if the account email is unverified', async () => {
    userService.findByEmail.mockResolvedValue({
      id: 42,
      public_id: 'returning_public',
      email: 'victim@example.com',
      status: 'ACTIVE',
      is_email_verified: false,
    });
    authMethodService.findByProviderUserId.mockResolvedValue({
      id: 7,
      user_id: 42,
      provider: 'google',
      provider_user_id: 'google-1',
    });

    const result = await callCompleteOAuthUserSession();

    expect(result.session_public_id).toBe('session_public');
    expect(authSessionService.createSessionForUser).toHaveBeenCalledTimes(1);
  });

  it('creates a new user on first-time OAuth signup', async () => {
    userService.findByEmail.mockResolvedValue(null);

    const result = await callCompleteOAuthUserSession();

    expect(userService.createFromOAuth).toHaveBeenCalledTimes(1);
    expect(result.session_public_id).toBe('session_public');
  });
});
