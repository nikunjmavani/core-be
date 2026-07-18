import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotImplementedError } from '@/shared/errors/index.js';
import { OAuthService } from '@/domains/auth/sub-domains/auth-method/oauth/oauth.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { OAuthProfile } from '@/domains/auth/sub-domains/auth-method/oauth/oauth.types.js';

vi.mock('@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js', () => ({
  assertOAuthProviderSupported: vi.fn((provider: string) => provider),
  createOAuthState: vi
    .fn()
    .mockResolvedValue({ state: 'oauth-state', codeVerifier: 'verifier', nonce: 'nonce' }),
  consumeOAuthState: vi.fn().mockResolvedValue({ provider: 'google', codeVerifier: 'verifier' }),
}));

vi.mock('@/domains/auth/sub-domains/auth-method/oauth/oauth-pkce.js', () => ({
  derivePkceCodeChallengeS256: vi.fn().mockReturnValue('code-challenge'),
}));

vi.mock('@/domains/auth/sub-domains/auth-method/oauth/providers/google-oauth.provider.js', () => ({
  buildGoogleOAuthRedirectUrl: vi.fn().mockReturnValue('https://google.example/oauth'),
  exchangeGoogleOAuthCode: vi.fn().mockResolvedValue({
    email: 'oauth@example.com',
    name: 'OAuth User',
    avatar_url: 'https://google.example/avatar.png',
    provider_user_id: 'google-user-123',
  } satisfies OAuthProfile),
}));

vi.mock('@/domains/auth/sub-domains/auth-method/oauth/providers/github-oauth.provider.js', () => ({
  buildGitHubOAuthRedirectUrl: vi.fn().mockReturnValue('https://github.example/oauth'),
  exchangeGitHubOAuthCode: vi.fn().mockResolvedValue({
    email: 'github@example.com',
    name: 'Git Hub',
    avatar_url: 'https://github.example/avatar.png',
    provider_user_id: 'github-user-456',
  } satisfies OAuthProfile),
}));

vi.mock('@/domains/auth/sub-domains/auth-method/oauth/oauth-user-session.js', () => ({
  completeOAuthUserSession: vi.fn().mockResolvedValue({
    access_token: 'oauth-access',
    session_public_id: 'session_oauth',
  }),
}));

describe('OAuthService', () => {
  const redis = {} as never;
  const userService = {} as UserService;
  const authMethodService = {} as AuthMethodService;
  const authSessionService = {} as AuthSessionService;
  const organizationSettingsService = {
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  } as never;
  const mfaService = { createMfaSession: vi.fn() } as never;
  const service = new OAuthService(
    userService,
    authMethodService,
    authSessionService,
    redis,
    organizationSettingsService,
    mfaService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listProviders returns supported providers', () => {
    const result = service.listProviders();
    expect(result.providers.length).toBeGreaterThan(0);
  });

  it('getRedirectUrl returns Google redirect plus a browser nonce', async () => {
    const result = await service.getRedirectUrl('google');
    expect(result.redirect_url).toContain('google');
    expect(result.nonce).toBe('nonce');
  });

  it('getRedirectUrl returns GitHub redirect', async () => {
    const { createOAuthState } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js'
    );
    const result = await service.getRedirectUrl('github');
    expect(result.redirect_url).toContain('github');
    expect(createOAuthState).toHaveBeenCalled();
  });

  it('handleCallback completes OAuth session for Google', async () => {
    const result = await service.handleCallback({
      provider: 'google',
      code: 'auth-code',
      state: 'oauth-state',
      nonce: 'nonce',
    });
    if (!('access_token' in result)) throw new Error('expected oauth session');
    expect(result.access_token).toBe('oauth-access');
    expect(result.session_public_id).toBe('session_oauth');
  });

  it('handleCallback uses default ip address when omitted', async () => {
    const { completeOAuthUserSession } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/oauth-user-session.js'
    );
    await service.handleCallback({
      provider: 'google',
      code: 'auth-code',
      state: 'oauth-state',
      nonce: 'nonce',
    });
    expect(completeOAuthUserSession).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
  });

  it('handleCallback completes OAuth session for GitHub', async () => {
    const { consumeOAuthState } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js'
    );
    vi.mocked(consumeOAuthState).mockResolvedValue({
      provider: 'github',
      codeVerifier: 'verifier',
    });

    const result = await service.handleCallback({
      provider: 'github',
      code: 'auth-code',
      state: 'oauth-state',
      nonce: 'nonce',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest-agent',
    });

    if (!('access_token' in result)) throw new Error('expected oauth session');
    expect(result.access_token).toBe('oauth-access');
  });

  it('getRedirectUrl throws for unsupported configured providers', async () => {
    const { assertOAuthProviderSupported } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js'
    );
    vi.mocked(assertOAuthProviderSupported).mockReturnValue('microsoft' as 'google');

    await expect(service.getRedirectUrl('microsoft')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('handleCallback exchanges provider authorization codes', async () => {
    const { consumeOAuthState } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js'
    );
    const { exchangeGitHubOAuthCode } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/providers/github-oauth.provider.js'
    );
    const { exchangeGoogleOAuthCode } = await import(
      '@/domains/auth/sub-domains/auth-method/oauth/providers/google-oauth.provider.js'
    );

    vi.mocked(consumeOAuthState).mockResolvedValue({
      provider: 'google',
      codeVerifier: 'gverifier',
    });
    await service.handleCallback({
      provider: 'google',
      code: 'google-code',
      state: 'oauth-state',
      nonce: 'nonce',
      requestId: 'req-google',
    });
    expect(exchangeGoogleOAuthCode).toHaveBeenCalledWith({
      code: 'google-code',
      codeVerifier: 'gverifier',
      requestId: 'req-google',
    });

    vi.mocked(consumeOAuthState).mockResolvedValue({
      provider: 'github',
      codeVerifier: 'hverifier',
    });
    await service.handleCallback({
      provider: 'github',
      code: 'github-code',
      state: 'oauth-state',
      nonce: 'nonce',
    });
    expect(exchangeGitHubOAuthCode).toHaveBeenCalledWith({
      code: 'github-code',
      codeVerifier: 'hverifier',
    });
  });
});
