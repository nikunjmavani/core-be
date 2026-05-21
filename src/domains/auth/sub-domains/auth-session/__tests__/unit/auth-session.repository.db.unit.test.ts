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

  it('revokes by token hash and revokes all sessions for user', async () => {
    const user = await createTestUser({ email: 'sessions@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    const first = await repository.create({
      user_id: user.id,
      token_hash: 'hash-one',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });
    await repository.create({
      user_id: user.id,
      token_hash: 'hash-two',
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
