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
  generateAuthenticationOptions: vi.fn(
    async ({ allowCredentials }: { allowCredentials: { id: string }[] }) => ({
      challenge: 'challenge',
      rpId: 'localhost',
      allowCredentials,
    }),
  ),
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

  it('rejects only when no email is supplied', async () => {
    await expect(service.generateAuthenticationOptions({})).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(service.generateAuthenticationOptions({})).rejects.toMatchObject({
      messageKey: 'errors:invalidEmailOrPassword',
    });
  });

  it('returns decoy options (not an error) for an unknown email to avoid enumeration', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);

    const result = await service.generateAuthenticationOptions({ email: 'missing@example.com' });

    expect(result.challenge_token).toBe('challenge-token');
    expect(result.options.allowCredentials).toHaveLength(1);
    expect(credentialRepository.listActiveByUserId).not.toHaveBeenCalled();
  });

  it('returns decoy options for a known email that has no registered passkeys', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      id: 1,
      public_id: 'abcdefghijklmnopqrstu',
      email: 'user@example.com',
    } as never);
    vi.mocked(credentialRepository.listActiveByUserId).mockResolvedValue([]);

    const result = await service.generateAuthenticationOptions({ email: 'user@example.com' });

    expect(result.challenge_token).toBe('challenge-token');
    expect(result.options.allowCredentials).toHaveLength(1);
  });

  it('derives a stable decoy credential id per email across repeated probes', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue(null);

    const first = await service.generateAuthenticationOptions({ email: 'probe@example.com' });
    const second = await service.generateAuthenticationOptions({ email: 'probe@example.com' });
    const other = await service.generateAuthenticationOptions({ email: 'different@example.com' });

    const firstId = (first.options.allowCredentials as { id: string }[])[0]?.id;
    const secondId = (second.options.allowCredentials as { id: string }[])[0]?.id;
    const otherId = (other.options.allowCredentials as { id: string }[])[0]?.id;

    expect(firstId).toBe(secondId);
    expect(firstId).not.toBe(otherId);
  });

  it('returns real credentials for a known email that has passkeys', async () => {
    vi.mocked(userService.findByEmail).mockResolvedValue({
      id: 7,
      public_id: 'abcdefghijklmnopqrstu',
      email: 'has-passkey@example.com',
    } as never);
    vi.mocked(credentialRepository.listActiveByUserId).mockResolvedValue([
      { credential_id: 'real-credential', transports: ['internal'] },
    ] as never);

    const result = await service.generateAuthenticationOptions({
      email: 'has-passkey@example.com',
    });

    const credentialIds = (result.options.allowCredentials as { id: string }[]).map(
      (credential) => credential.id,
    );
    expect(credentialIds).toContain('real-credential');
  });
});
