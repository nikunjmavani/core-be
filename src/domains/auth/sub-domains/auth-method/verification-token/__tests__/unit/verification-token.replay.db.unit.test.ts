import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';

describe('VerificationTokenRepository — atomic consume (replay protection)', () => {
  const repository = new VerificationTokenRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('consumeIfValid returns null on second call (replay rejected)', async () => {
    const user = await createTestUser();
    const tokenHash = `replay-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('MAGIC_LINK', user.id, user.email, tokenHash, expiresAt);

    const first = await repository.consumeIfValid(tokenHash, 'MAGIC_LINK');
    expect(first?.token_hash).toBe(tokenHash);

    const second = await repository.consumeIfValid(tokenHash, 'MAGIC_LINK');
    expect(second).toBeNull();
  });

  it('consumeIfValid returns null for expired tokens', async () => {
    const user = await createTestUser({ email: 'expired-token@example.com' });
    const tokenHash = `expired-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() - 60_000);
    await repository.create('PASSWORD_RESET', user.id, user.email, tokenHash, expiresAt);

    const result = await repository.consumeIfValid(tokenHash, 'PASSWORD_RESET');
    expect(result).toBeNull();
  });

  it('sec-r5-L2: consumeIfValid returns null for a token of a different type (cross-type rejected)', async () => {
    const user = await createTestUser({ email: 'cross-type-token@example.com' });
    const tokenHash = `cross-type-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('PASSWORD_RESET', user.id, user.email, tokenHash, expiresAt);

    // A valid PASSWORD_RESET token replayed against the MAGIC_LINK flow must not match — and
    // therefore must not be consumed (burned): the row stays redeemable on its own flow.
    const wrongType = await repository.consumeIfValid(tokenHash, 'MAGIC_LINK');
    expect(wrongType).toBeNull();
    const rightType = await repository.consumeIfValid(tokenHash, 'PASSWORD_RESET');
    expect(rightType?.token_hash).toBe(tokenHash);
  });

  it('consumeIfValid only allows one winner under concurrent consume attempts', async () => {
    const user = await createTestUser({ email: 'concurrent-token@example.com' });
    const tokenHash = `concurrent-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('MAGIC_LINK', user.id, user.email, tokenHash, expiresAt);

    const results = await Promise.all([
      repository.consumeIfValid(tokenHash, 'MAGIC_LINK'),
      repository.consumeIfValid(tokenHash, 'MAGIC_LINK'),
      repository.consumeIfValid(tokenHash, 'MAGIC_LINK'),
    ]);

    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
  });

  it('findValidByTokenHash excludes already-consumed tokens', async () => {
    const user = await createTestUser({ email: 'find-after-consume@example.com' });
    const tokenHash = `find-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_VERIFICATION', user.id, user.email, tokenHash, expiresAt);

    await repository.consumeIfValid(tokenHash, 'EMAIL_VERIFICATION');
    const found = await repository.findValidByTokenHash(tokenHash);
    expect(found).toBeNull();
  });

  it('invalidateAllForUser only invalidates the specified token type', async () => {
    const user = await createTestUser({ email: 'invalidate-type@example.com' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('MAGIC_LINK', user.id, user.email, 'magic-hash', expiresAt);
    await repository.create('PASSWORD_RESET', user.id, user.email, 'reset-hash', expiresAt);

    await repository.invalidateAllForUser(user.id, 'MAGIC_LINK');

    expect(await repository.findValidByTokenHash('magic-hash')).toBeNull();
    expect(await repository.findValidByTokenHash('reset-hash')).not.toBeNull();
  });
});
