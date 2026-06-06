import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { mfa_recovery_codes } from './auth-mfa-recovery-code.schema.js';

/**
 * Bulk-insert hashed recovery codes for `userId` (typically 10 codes, all freshly generated
 * by the enroll-confirm path). The caller MUST already hash the plaintext via
 * {@link hashMfaRecoveryCode} so this repository never sees the plaintext. Idempotent by the
 * unique `(user_id, code_hash)` partial index — duplicate hashes silently skip on conflict.
 * RLS-gated by `app.current_user_id`, so callers must invoke this inside
 * `withUserDatabaseContext`.
 */
export async function insertMfaRecoveryCodes(
  userId: number,
  codeHashes: readonly string[],
): Promise<void> {
  if (codeHashes.length === 0) return;
  await getRequestDatabase()
    .insert(mfa_recovery_codes)
    .values(codeHashes.map((codeHash) => ({ user_id: userId, code_hash: codeHash })))
    .onConflictDoNothing({
      target: [mfa_recovery_codes.user_id, mfa_recovery_codes.code_hash],
    });
}

/** SHA-256 hash of a recovery code; only the hash is ever persisted in {@link mfa_recovery_codes}. */
export function hashMfaRecoveryCode(plainCode: string): string {
  return createHash('sha256').update(plainCode).digest('hex');
}

/**
 * Atomically consumes a recovery code for `userId`: sets `used_at` only when the row is still unused;
 * returns `true` on success and `false` on unknown / already-consumed codes. Enforces the single-use
 * invariant via the UPDATE filter. `auth.mfa_recovery_codes` is FORCE RLS keyed on
 * `app.current_user_id`, so callers must invoke this inside `withUserDatabaseContext`.
 */
export async function consumeMfaRecoveryCode(userId: number, plainCode: string): Promise<boolean> {
  const codeHash = hashMfaRecoveryCode(plainCode);
  const rows = await getRequestDatabase()
    .update(mfa_recovery_codes)
    .set({ used_at: databaseNowTimestamp })
    .where(
      and(
        eq(mfa_recovery_codes.user_id, userId),
        eq(mfa_recovery_codes.code_hash, codeHash),
        isNull(mfa_recovery_codes.used_at),
      ),
    )
    .returning({ id: mfa_recovery_codes.id });

  return rows.length > 0;
}
