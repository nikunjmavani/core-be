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
    }),
  };
  const authMethodService = {
    linkOAuthProviderIfMissing: vi.fn().mockResolvedValue(undefined),
  };
  const authSessionService = {
    createSessionForUser: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userService.findByEmail.mockResolvedValue(null);
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
});
