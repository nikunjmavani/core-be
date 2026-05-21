import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { mfa_recovery_codes } from './mfa-recovery-code.schema.js';

export function hashMfaRecoveryCode(plainCode: string): string {
  return createHash('sha256').update(plainCode).digest('hex');
}

export async function consumeMfaRecoveryCode(userId: number, plainCode: string): Promise<boolean> {
  const codeHash = hashMfaRecoveryCode(plainCode);
  const rows = await database
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
