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
    await repository.create('EMAIL_CODE', user.id, user.email, tokenHash, expiresAt);

    const first = await repository.consumeIfValid(tokenHash, 'EMAIL_CODE');
    expect(first?.token_hash).toBe(tokenHash);

    const second = await repository.consumeIfValid(tokenHash, 'EMAIL_CODE');
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

    // A valid PASSWORD_RESET token replayed against the EMAIL_CODE flow must not match — and
    // therefore must not be consumed (burned): the row stays redeemable on its own flow.
    const wrongType = await repository.consumeIfValid(tokenHash, 'EMAIL_CODE');
    expect(wrongType).toBeNull();
    const rightType = await repository.consumeIfValid(tokenHash, 'PASSWORD_RESET');
    expect(rightType?.token_hash).toBe(tokenHash);
  });

  it('consumeIfValid only allows one winner under concurrent consume attempts', async () => {
    const user = await createTestUser({ email: 'concurrent-token@example.com' });
    const tokenHash = `concurrent-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_CODE', user.id, user.email, tokenHash, expiresAt);

    const results = await Promise.all([
      repository.consumeIfValid(tokenHash, 'EMAIL_CODE'),
      repository.consumeIfValid(tokenHash, 'EMAIL_CODE'),
      repository.consumeIfValid(tokenHash, 'EMAIL_CODE'),
    ]);

    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
  });

  it('findValidByTokenHash excludes already-consumed tokens', async () => {
    const user = await createTestUser({ email: 'find-after-consume@example.com' });
    const tokenHash = `find-hash-${user.public_id}`;
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_CHANGE', user.id, user.email, tokenHash, expiresAt);

    await repository.consumeIfValid(tokenHash, 'EMAIL_CHANGE');
    const found = await repository.findValidByTokenHash(tokenHash);
    expect(found).toBeNull();
  });

  it('invalidateAllForUser only invalidates the specified token type', async () => {
    const user = await createTestUser({ email: 'invalidate-type@example.com' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_CODE', user.id, user.email, 'magic-hash', expiresAt);
    await repository.create('PASSWORD_RESET', user.id, user.email, 'reset-hash', expiresAt);

    await repository.invalidateAllForUser(user.id, 'EMAIL_CODE');

    expect(await repository.findValidByTokenHash('magic-hash')).toBeNull();
    expect(await repository.findValidByTokenHash('reset-hash')).not.toBeNull();
  });

  it('invalidateAllByUser invalidates EVERY token type for the user (offboarding), leaving other users untouched', async () => {
    // The sibling above pins the single-type method. Offboarding uses the type-agnostic
    // invalidateAllByUser (no token_type predicate): a soft-deleted user must be left with no live
    // token of ANY type, or a still-valid PASSWORD_RESET/EMAIL_CHANGE could resurrect the account.
    const userA = await createTestUser({ email: 'invalidate-all-a@example.com' });
    const userB = await createTestUser({ email: 'invalidate-all-b@example.com' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_CODE', userA.id, userA.email, 'a-code', expiresAt);
    await repository.create('PASSWORD_RESET', userA.id, userA.email, 'a-reset', expiresAt);
    await repository.create('EMAIL_CHANGE', userA.id, userA.email, 'a-change', expiresAt);
    await repository.create('EMAIL_CODE', userB.id, userB.email, 'b-code', expiresAt);

    await repository.invalidateAllByUser(userA.id);

    // Every one of user A's tokens is gone, regardless of type.
    expect(await repository.findValidByTokenHash('a-code')).toBeNull();
    expect(await repository.findValidByTokenHash('a-reset')).toBeNull();
    expect(await repository.findValidByTokenHash('a-change')).toBeNull();
    // The invalidation is user-scoped — user B's token survives.
    expect(await repository.findValidByTokenHash('b-code')).not.toBeNull();
  });

  it('consumeOtpForUser will not consume another user’s code (cross-user isolation)', async () => {
    // The atomic consume is keyed on user_id: presenting a valid code hash that belongs to a
    // DIFFERENT user must neither authenticate nor burn the victim’s code.
    const attacker = await createTestUser({ email: 'otp-attacker@example.com' });
    const victim = await createTestUser({ email: 'otp-victim@example.com' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await repository.create('EMAIL_CODE', victim.id, victim.email, 'shared-code-hash', expiresAt);

    // Attacker presents the victim’s exact code hash under their own id → no match, no burn.
    expect(
      await repository.consumeOtpForUser(attacker.id, 'EMAIL_CODE', 'shared-code-hash'),
    ).toBeNull();

    // The victim’s code was untouched by the attacker’s attempt and is still redeemable by them…
    const consumed = await repository.consumeOtpForUser(
      victim.id,
      'EMAIL_CODE',
      'shared-code-hash',
    );
    expect(consumed?.user_id).toBe(victim.id);
    // …and single-use thereafter.
    expect(
      await repository.consumeOtpForUser(victim.id, 'EMAIL_CODE', 'shared-code-hash'),
    ).toBeNull();
  });
});
