import { describe, it, expect, beforeEach } from 'vitest';
import { database } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import {
  consumeMfaRecoveryCode,
  hashMfaRecoveryCode,
} from '@/domains/auth/sub-domains/auth-mfa/mfa-recovery-code.repository.js';
import { mfa_recovery_codes } from '@/domains/auth/sub-domains/auth-mfa/mfa-recovery-code.schema.js';

async function seedRecoveryCode(userId: number, plainCode: string): Promise<void> {
  await database.insert(mfa_recovery_codes).values({
    user_id: userId,
    code_hash: hashMfaRecoveryCode(plainCode),
  });
}

describe('mfa-recovery-code.repository — single-use enforcement', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('returns true the first time a valid recovery code is consumed', async () => {
    const user = await createTestUser();
    await seedRecoveryCode(user.id, 'ABCD-1234');

    const result = await consumeMfaRecoveryCode(user.id, 'ABCD-1234');
    expect(result).toBe(true);
  });

  it('returns false when the same recovery code is replayed', async () => {
    const user = await createTestUser({ email: 'recovery-replay@example.com' });
    await seedRecoveryCode(user.id, 'EFGH-5678');

    expect(await consumeMfaRecoveryCode(user.id, 'EFGH-5678')).toBe(true);
    expect(await consumeMfaRecoveryCode(user.id, 'EFGH-5678')).toBe(false);
  });

  it('returns false for an unknown recovery code', async () => {
    const user = await createTestUser({ email: 'unknown-code@example.com' });
    await seedRecoveryCode(user.id, 'KNOWN-CODE');

    const result = await consumeMfaRecoveryCode(user.id, 'UNKNOWN-CODE');
    expect(result).toBe(false);
  });

  it('does not consume another user\u2019s code with the same plain text', async () => {
    const userA = await createTestUser({ email: 'codeA@example.com' });
    const userB = await createTestUser({ email: 'codeB@example.com' });
    await seedRecoveryCode(userA.id, 'SHARED-CODE');

    expect(await consumeMfaRecoveryCode(userB.id, 'SHARED-CODE')).toBe(false);
    expect(await consumeMfaRecoveryCode(userA.id, 'SHARED-CODE')).toBe(true);
  });

  it('only one concurrent consume succeeds for the same code', async () => {
    const user = await createTestUser({ email: 'recovery-concurrent@example.com' });
    await seedRecoveryCode(user.id, 'RACE-CODE');

    const results = await Promise.all([
      consumeMfaRecoveryCode(user.id, 'RACE-CODE'),
      consumeMfaRecoveryCode(user.id, 'RACE-CODE'),
      consumeMfaRecoveryCode(user.id, 'RACE-CODE'),
    ]);

    const winners = results.filter((value) => value === true);
    expect(winners).toHaveLength(1);
  });
});
