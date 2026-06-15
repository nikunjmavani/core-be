import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';

describe('AuthMethodRepository (database)', () => {
  const repository = new AuthMethodRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates, lists, finds, updates, and revokes auth methods', async () => {
    const user = await createTestUser();

    const created = await repository.create({
      user_id: user.id,
      method_type: 'MFA_TOTP',
      encrypted_secret: 'secret',
      is_primary: false,
      created_by_user_id: user.id,
    });

    const listed = await repository.listByUserId(user.id);
    expect(listed.some((row) => row.id === created.id)).toBe(true);

    const totp = await repository.findTotpByUserId(user.id);
    expect(totp?.id).toBe(created.id);

    await repository.updateLastUsedAt(created.id, user.id);
    const mfaListed = await repository.listMfaByUserId(user.id);
    expect(mfaListed).toHaveLength(1);

    const byId = await repository.findByIdForUser(created.id, user.id);
    expect(byId?.method_type).toBe('MFA_TOTP');

    const oauth = await repository.create({
      user_id: user.id,
      method_type: 'OAUTH',
      provider: 'google',
      provider_user_id: 'google-user-1',
      is_primary: true,
      created_by_user_id: user.id,
    });
    const byProvider = await repository.findByProviderUserId('google', 'google-user-1');
    expect(byProvider?.id).toBe(oauth.id);

    const revoked = await repository.revoke(created.id, user.id);
    expect(revoked?.revoked_at).not.toBeNull();

    await repository.revokeAllByUserId(user.id);
    const afterRevokeAll = await repository.listByUserId(user.id);
    expect(afterRevokeAll).toHaveLength(0);
  });

  it('route-audit C1: revokeUnlessLastLoginCapable refuses to revoke the last login-capable method', async () => {
    const LOGIN_CAPABLE = ['PASSWORD', 'OAUTH', 'MAGIC_LINK'];
    const user = await createTestUser({ email: 'last-login-capable@test.com' });

    const password = await repository.create({
      user_id: user.id,
      method_type: 'PASSWORD',
      is_primary: true,
      created_by_user_id: user.id,
    });
    const oauth = await repository.create({
      user_id: user.id,
      method_type: 'OAUTH',
      provider: 'github',
      provider_user_id: 'github-user-c1',
      is_primary: false,
      created_by_user_id: user.id,
    });
    const mfa = await repository.create({
      user_id: user.id,
      method_type: 'MFA_TOTP',
      encrypted_secret: 'secret',
      is_primary: false,
      created_by_user_id: user.id,
    });

    // PASSWORD is revocable while OAUTH (another login-capable method) remains.
    expect(
      await repository.revokeUnlessLastLoginCapable(password.id, user.id, LOGIN_CAPABLE),
    ).not.toBeNull();

    // OAUTH is now the LAST login-capable method → the atomic guard refuses (null) and it stays active.
    expect(
      await repository.revokeUnlessLastLoginCapable(oauth.id, user.id, LOGIN_CAPABLE),
    ).toBeNull();
    expect(await repository.findByIdForUser(oauth.id, user.id)).not.toBeNull();

    // MFA is not login-capable → revocable regardless of how many login methods remain.
    expect(
      await repository.revokeUnlessLastLoginCapable(mfa.id, user.id, LOGIN_CAPABLE),
    ).not.toBeNull();
  });
});
