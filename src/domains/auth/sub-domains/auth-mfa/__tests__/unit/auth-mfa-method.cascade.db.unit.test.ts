import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { mfa_methods } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa-method.schema.js';
import { users } from '@/domains/user/user.schema.js';

describe('auth.mfa_methods user FK (reaudit-#1)', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('cascade-deletes MFA methods (and their encrypted secrets) when the user row is hard-deleted', async () => {
    const user = await createTestUser();
    await database.insert(mfa_methods).values({
      public_id: generatePublicId('authMfaMethod'),
      user_id: user.id,
      method_type: 'TOTP',
      encrypted_secret: 'enc-secret',
      is_verified: true,
    });

    const before = await database
      .select({ id: mfa_methods.id })
      .from(mfa_methods)
      .where(eq(mfa_methods.user_id, user.id));
    expect(before).toHaveLength(1);

    // Hard delete the user (what user-tombstone retention does after the window).
    await database.delete(users).where(eq(users.id, user.id));

    // FK ON DELETE CASCADE must have purged the MFA secret — no GDPR orphan.
    const after = await database
      .select({ id: mfa_methods.id })
      .from(mfa_methods)
      .where(eq(mfa_methods.user_id, user.id));
    expect(after).toHaveLength(0);
  });

  it('rejects an MFA method row whose user_id does not exist (FK enforced)', async () => {
    await expect(
      database.insert(mfa_methods).values({
        public_id: generatePublicId('authMfaMethod'),
        user_id: 999_999_999,
        method_type: 'TOTP',
        encrypted_secret: 'enc-secret',
      }),
    ).rejects.toThrow();
  });
});
