import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token.repository.js';

describe('VerificationTokenRepository (database)', () => {
  const repository = new VerificationTokenRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates, finds valid, consumes, and marks used tokens', async () => {
    const user = await createTestUser();
    const tokenHash = `hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);

    await repository.create('MAGIC_LINK', user.id, user.email, tokenHash, expiresAt);

    const valid = await repository.findValidByTokenHash(tokenHash);
    expect(valid?.user_id).toBe(user.id);

    const consumed = await repository.consumeIfValid(tokenHash);
    expect(consumed?.token_hash).toBe(tokenHash);

    const afterConsume = await repository.findValidByTokenHash(tokenHash);
    expect(afterConsume).toBeNull();

    const secondHash = `hash-second-${user.public_id}`;
    await repository.create('PASSWORD_RESET', user.id, user.email, secondHash, expiresAt);
    await repository.markUsed(secondHash);
    const marked = await repository.findValidByTokenHash(secondHash);
    expect(marked).toBeNull();
  });

  it('invalidates all unused tokens of a type for user', async () => {
    const user = await createTestUser({ email: 'invalidate@example.com' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_VERIFICATION', user.id, user.email, 'hash-a', expiresAt);
    await repository.create('EMAIL_VERIFICATION', user.id, user.email, 'hash-b', expiresAt);

    await repository.invalidateAllForUser(user.id, 'EMAIL_VERIFICATION');

    expect(await repository.findValidByTokenHash('hash-a')).toBeNull();
    expect(await repository.findValidByTokenHash('hash-b')).toBeNull();
  });
});
