import { describe, it, expect, vi } from 'vitest';
import { VerificationTokenService } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.service.js';
import type {
  VerificationTokenRepository,
  VerificationTokenType,
} from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-02T00:00:00.000Z');

const tokenRow = {
  id: 1,
  user_id: 10,
  email: 'test@example.com',
  token_hash: 'hashed-token-abc',
  token_type: 'EMAIL_CODE' as VerificationTokenType,
  used_at: null,
  expires_at: expiresAt,
  created_at: now,
};

describe('VerificationTokenService', () => {
  const repository = {
    create: vi.fn().mockResolvedValue(tokenRow),
    consumeIfValid: vi.fn().mockResolvedValue(tokenRow),
    invalidateAllForUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as VerificationTokenRepository;

  const service = new VerificationTokenService(repository);

  describe('create', () => {
    it('delegates to repository and returns created token row', async () => {
      const result = await service.create(
        'EMAIL_CODE',
        10,
        'test@example.com',
        'hashed-token-abc',
        expiresAt,
      );
      expect(repository.create).toHaveBeenCalledWith(
        'EMAIL_CODE',
        10,
        'test@example.com',
        'hashed-token-abc',
        expiresAt,
      );
      expect(result).toEqual(tokenRow);
    });

    it('propagates repository errors', async () => {
      vi.mocked(repository.create).mockRejectedValueOnce(new Error('DB constraint violation'));
      await expect(
        service.create('EMAIL_CODE', 10, 'test@example.com', 'hashed-token-abc', expiresAt),
      ).rejects.toThrow('DB constraint violation');
    });
  });

  describe('consumeIfValid', () => {
    it('delegates to repository with the expected token type and returns the row', async () => {
      const result = await service.consumeIfValid('hashed-token-abc', 'EMAIL_CODE');
      expect(repository.consumeIfValid).toHaveBeenCalledWith('hashed-token-abc', 'EMAIL_CODE');
      expect(result).toEqual(tokenRow);
    });

    it('returns null for missing or already-used token (repository returns null)', async () => {
      vi.mocked(repository.consumeIfValid).mockResolvedValueOnce(null);
      const result = await service.consumeIfValid('expired-token-hash', 'PASSWORD_RESET');
      expect(result).toBeNull();
    });

    it('propagates repository errors', async () => {
      vi.mocked(repository.consumeIfValid).mockRejectedValueOnce(new Error('Connection timeout'));
      await expect(service.consumeIfValid('token-hash', 'EMAIL_CODE')).rejects.toThrow(
        'Connection timeout',
      );
    });
  });

  describe('invalidateAllForUser', () => {
    it('delegates to repository with user id and token type', async () => {
      await service.invalidateAllForUser(10, 'EMAIL_CODE');
      expect(repository.invalidateAllForUser).toHaveBeenCalledWith(10, 'EMAIL_CODE');
    });

    it('handles different token types', async () => {
      await service.invalidateAllForUser(10, 'EMAIL_CHANGE');
      expect(repository.invalidateAllForUser).toHaveBeenCalledWith(10, 'EMAIL_CHANGE');
    });

    it('propagates repository errors', async () => {
      vi.mocked(repository.invalidateAllForUser).mockRejectedValueOnce(new Error('DB timeout'));
      await expect(service.invalidateAllForUser(10, 'EMAIL_CODE')).rejects.toThrow('DB timeout');
    });
  });
});
