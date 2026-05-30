import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { WebauthnService } from '@/domains/auth/sub-domains/auth-webauthn/webauthn.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { WebauthnCredentialRepository } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.repository.js';

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

vi.mock('@/domains/auth/sub-domains/auth-webauthn/webauthn-challenge.js', () => ({
  createWebauthnChallenge: vi.fn().mockResolvedValue('challenge-token'),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi
    .fn()
    .mockResolvedValue({ challenge: 'challenge', rpId: 'localhost' }),
}));

describe('WebauthnService.generateAuthenticationOptions', () => {
  const userService = {
    findByEmail: vi.fn(),
  } as unknown as UserService;

  const credentialRepository = {
    listActiveByUserId: vi.fn(),
  } as unknown as WebauthnCredentialRepository;

  const service = new WebauthnService(
    userService,
    {} as never,
    credentialRepository,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the same auth error for missing email, unknown user, and user without passkeys', async () => {
    await expect(service.generateAuthenticationOptions({})).rejects.toMatchObject({
      messageKey: 'errors:invalidEmailOrPassword',
    });

    vi.mocked(userService.findByEmail).mockResolvedValue(null);
    await expect(
      service.generateAuthenticationOptions({ email: 'missing@example.com' }),
    ).rejects.toMatchObject({ messageKey: 'errors:invalidEmailOrPassword' });

    vi.mocked(userService.findByEmail).mockResolvedValue({
      id: 1,
      public_id: 'abcdefghijklmnopqrstu',
      email: 'user@example.com',
    } as never);
    vi.mocked(credentialRepository.listActiveByUserId).mockResolvedValue([]);
    await expect(
      service.generateAuthenticationOptions({ email: 'user@example.com' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      service.generateAuthenticationOptions({ email: 'user@example.com' }),
    ).rejects.toMatchObject({ messageKey: 'errors:invalidEmailOrPassword' });
  });
});
