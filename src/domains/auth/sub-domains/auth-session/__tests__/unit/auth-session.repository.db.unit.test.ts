import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';

describe('AuthSessionRepository (database)', () => {
  const repository = new AuthSessionRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates, lists, rotates token hash, and revokes sessions', async () => {
    const user = await createTestUser();
    const expiresAt = new Date(Date.now() + 86_400_000);

    const session = await repository.create({
      user_id: user.id,
      token_hash: 'initial-hash',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    const listed = await repository.listByUserId(user.id);
    expect(listed.some((row) => row.public_id === session.public_id)).toBe(true);

    const byPublicId = await repository.findByPublicId(session.public_id);
    expect(byPublicId?.user_id).toBe(user.id);

    const byPublicIdForUser = await repository.findByPublicIdForUser(session.public_id, user.id);
    expect(byPublicIdForUser?.public_id).toBe(session.public_id);

    await repository.updateLastActiveAt(session.public_id);
    await repository.rotateTokenHash(session.public_id, 'rotated-hash');

    const byRotatedHash = await repository.findByTokenHash('rotated-hash');
    expect(byRotatedHash?.public_id).toBe(session.public_id);

    const revoked = await repository.revoke(session.public_id, user.id);
    expect(revoked?.token_hash).toBe('rotated-hash');

    const afterRevoke = await repository.findByPublicId(session.public_id);
    expect(afterRevoke).toBeNull();
  });

  it('revokeOldestActiveBeyond keeps the newest sessions and revokes the oldest beyond keepCount', async () => {
    const user = await createTestUser({ email: 'session-cap@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);
    for (let index = 0; index < 5; index++) {
      await repository.create({
        user_id: user.id,
        token_hash: `cap-hash-${index}`,
        refresh_token_hash: 'refresh-hash',
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        expires_at: expiresAt,
      });
    }

    // Keep the 2 most-recently-created, revoke the oldest 3 (by created_at then id).
    const evicted = await repository.revokeOldestActiveBeyond(user.id, 2);
    expect(evicted).toHaveLength(3);
    expect(evicted.map((row) => row.token_hash).sort()).toEqual([
      'cap-hash-0',
      'cap-hash-1',
      'cap-hash-2',
    ]);

    const remaining = await repository.listByUserId(user.id);
    expect(remaining.map((row) => row.token_hash).sort()).toEqual(['cap-hash-3', 'cap-hash-4']);
  });

  it('revokeOldestActiveBeyond is a no-op when the user is at or under keepCount', async () => {
    const user = await createTestUser({ email: 'session-undercap@example.com' });
    await repository.create({
      user_id: user.id,
      token_hash: 'under-cap-1',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: new Date(Date.now() + 86_400_000),
    });

    const evicted = await repository.revokeOldestActiveBeyond(user.id, 5);
    expect(evicted).toHaveLength(0);
    expect(await repository.listByUserId(user.id)).toHaveLength(1);
  });

  it('revokes by token hash and revokes all sessions for user', async () => {
    const user = await createTestUser({ email: 'sessions@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    const first = await repository.create({
      user_id: user.id,
      token_hash: 'hash-one',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });
    await repository.create({
      user_id: user.id,
      token_hash: 'hash-two',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    const revokedByHash = await repository.revokeByTokenHash('hash-one');
    expect(revokedByHash?.public_id).toBe(first.public_id);

    await repository.revokeAllByUserId(user.id);
    const remaining = await repository.listByUserId(user.id);
    expect(remaining).toHaveLength(0);
  });
});
