import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

describe('UserRepository (database)', () => {
  const repository = new UserRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('finds, updates, lists, suspends, and soft-deletes users', async () => {
    const user = await createTestUser({ email: 'repo-user@example.com' });

    const byEmail = await repository.findByEmail('repo-user@example.com');
    expect(byEmail?.public_id).toBe(user.public_id);

    const byPublicId = await repository.findByPublicId(user.public_id);
    expect(byPublicId?.id).toBe(user.id);

    const byId = await repository.findById(user.id);
    expect(byId?.email).toBe('repo-user@example.com');

    const updated = await repository.update(user.public_id, { first_name: 'Updated' });
    expect(updated?.first_name).toBe('Updated');

    await repository.updatePassword(user.public_id, 'new-hash');
    const withPassword = await repository.findByPublicId(user.public_id);
    expect(withPassword?.password_hash).toBe('new-hash');

    await repository.updateEmailVerified(user.public_id);
    const verified = await repository.findByPublicId(user.public_id);
    expect(verified?.is_email_verified).toBe(true);

    const listed = await repository.findMany({ limit: 20, search: 'repo-user' });
    expect(listed.items.some((row) => row.public_id === user.public_id)).toBe(true);
    expect(listed.total).toBeNull();

    const listedWithTotal = await repository.findMany({
      limit: 20,
      search: 'repo-user',
      include_total: true,
    });
    expect(listedWithTotal.total).toBeGreaterThanOrEqual(1);

    const suspended = await repository.suspend(user.public_id);
    expect(suspended?.status).toBe('SUSPENDED');

    const unsuspended = await repository.unsuspend(user.public_id);
    expect(unsuspended?.status).toBe('ACTIVE');

    await repository.updateMfaEnabled(user.public_id, true);
    const withMfa = await repository.findByPublicId(user.public_id);
    expect(withMfa?.is_mfa_enabled).toBe(true);

    await repository.updateLoginAttempt(user.public_id, 3, new Date(Date.now() + 60_000));
    const withLock = await repository.findByPublicId(user.public_id);
    expect(withLock?.failed_login_count).toBe(3);

    const adminUpdated = await repository.adminUpdate(user.public_id, { status: 'SUSPENDED' });
    expect(adminUpdated?.status).toBe('SUSPENDED');

    // Soft-delete is a two-phase contract: deletion must be marked started before the row can be
    // soft-deleted (mirrors UserService.softDeleteUserWithOffboarding).
    await repository.markDeletionStarted(user.public_id);
    await repository.softDelete(user.public_id);
    const afterDelete = await repository.findByPublicId(user.public_id);
    expect(afterDelete).toBeNull();
  });

  it('insertOAuthUser inserts oauth user with the supplied public_id', async () => {
    const publicId = generatePublicId();
    const oauthUser = await repository.insertOAuthUser(publicId, {
      email: 'oauth-user@example.com',
      first_name: 'OAuth',
      is_email_verified: true,
    });
    expect(oauthUser.public_id).toBe(publicId);
    expect(oauthUser.email).toBe('oauth-user@example.com');
    expect(oauthUser.is_email_verified).toBe(true);
  });

  it('incrementFailedLoginAttempt counts every concurrent failure (no lost updates)', async () => {
    const user = await createTestUser({ email: 'concurrent-failed-login@example.com' });
    const attempts = 8;
    const maxAttempts = 10;

    // Fire all failures at once. A read-modify-write would let several collapse into one
    // (two reads of N both write N+1); the atomic `count + 1` must land all of them.
    await Promise.all(
      Array.from({ length: attempts }, () =>
        repository.incrementFailedLoginAttempt(user.public_id, { maxAttempts, lockoutMinutes: 30 }),
      ),
    );

    const after = await repository.findByPublicId(user.public_id);
    expect(after?.failed_login_count).toBe(attempts);
    // Below the threshold, no lock is applied.
    expect(after?.account_locked_until).toBeNull();
  });

  it('incrementFailedLoginAttempt applies the lockout once the threshold is reached', async () => {
    const user = await createTestUser({ email: 'lockout-threshold@example.com' });
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await repository.incrementFailedLoginAttempt(user.public_id, {
        maxAttempts,
        lockoutMinutes: 30,
      });
    }

    const after = await repository.findByPublicId(user.public_id);
    expect(after?.failed_login_count).toBe(maxAttempts);
    expect(after?.account_locked_until).not.toBeNull();
    expect(new Date(after?.account_locked_until as unknown as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});
