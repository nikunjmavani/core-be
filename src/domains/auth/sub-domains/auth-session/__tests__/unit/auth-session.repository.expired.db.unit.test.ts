import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';

describe('AuthSessionRepository — expiry, revocation, and idempotency', () => {
  const repository = new AuthSessionRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('findActiveByTokenHash excludes expired sessions', async () => {
    const user = await createTestUser();

    // Insert directly with both created_at and expires_at backdated; chk_sessions_expires only
    // requires expires_at > created_at, both can be in the past.
    const pastCreated = new Date(Date.now() - 7_200_000).toISOString();
    const pastExpires = new Date(Date.now() - 3_600_000).toISOString();
    await sql`
      INSERT INTO auth.sessions
        (public_id, user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_active_at)
      VALUES (
        'sess_expired_test_aaa',
        ${user.id},
        'expired-hash',
        '127.0.0.1',
        'vitest',
        ${pastExpires}::timestamptz,
        ${pastCreated}::timestamptz,
        ${pastCreated}::timestamptz
      )
    `;

    const result = await repository.findActiveByTokenHash('expired-hash');
    expect(result).toBeNull();
  });

  it('findActiveByTokenHash excludes revoked sessions', async () => {
    const user = await createTestUser({ email: 'revoked-session@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    const session = await repository.create({
      user_id: user.id,
      token_hash: 'revoked-hash',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    await repository.revoke(session.public_id, user.id);

    const result = await repository.findActiveByTokenHash('revoked-hash');
    expect(result).toBeNull();
  });

  it('findActiveByTokenHash returns active session for valid bearer token', async () => {
    const user = await createTestUser({ email: 'valid-session@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    await repository.create({
      user_id: user.id,
      token_hash: 'active-hash',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    const result = await repository.findActiveByTokenHash('active-hash');
    expect(result?.user_id).toBe(user.id);
  });

  it('revokeByTokenHash returns the session on first call', async () => {
    const user = await createTestUser({ email: 'revoke-by-hash@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    await repository.create({
      user_id: user.id,
      token_hash: 'hash-to-revoke',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    const revoked = await repository.revokeByTokenHash('hash-to-revoke');
    expect(revoked?.is_revoked).toBe(true);
  });

  it('revokeByTokenHash is idempotent for an already-revoked token', async () => {
    const user = await createTestUser({ email: 'revoke-idempotent@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    await repository.create({
      user_id: user.id,
      token_hash: 'hash-double',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });

    const first = await repository.revokeByTokenHash('hash-double');
    expect(first?.is_revoked).toBe(true);

    // Second call still updates (no-op effect) and returns the row without throwing
    const second = await repository.revokeByTokenHash('hash-double');
    expect(second?.is_revoked).toBe(true);
  });

  it('revokeByTokenHash returns null when no session has that hash', async () => {
    const result = await repository.revokeByTokenHash('missing-hash');
    expect(result).toBeNull();
  });

  it('revokeAllByUserId revokes only currently-active sessions', async () => {
    const user = await createTestUser({ email: 'revoke-all@example.com' });
    const expiresAt = new Date(Date.now() + 86_400_000);

    await repository.create({
      user_id: user.id,
      token_hash: 'one',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });
    await repository.create({
      user_id: user.id,
      token_hash: 'two',
      refresh_token_hash: 'refresh-hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: expiresAt,
    });
    await repository.revokeByTokenHash('one');

    const revokedTokens = await repository.revokeAllByUserId(user.id);
    expect(revokedTokens.map((row) => row.token_hash)).toContain('two');
    expect(revokedTokens.map((row) => row.token_hash)).not.toContain('one');
  });
});
