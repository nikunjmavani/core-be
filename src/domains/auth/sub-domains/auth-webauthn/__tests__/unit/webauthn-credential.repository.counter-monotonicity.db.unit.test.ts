import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { WebauthnCredentialRepository } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.repository.js';
import { webauthn_credentials } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.schema.js';

/**
 * Real-DB counterpart to the mocked `counter-monotonicity.unit.test.ts`. The mocked test only
 * proves which Drizzle operator is selected; it never executes a write, so it cannot prove a
 * regressed counter is actually rejected (stored value unchanged) or that the 0 -> 0 no-op is
 * accepted. A cloned authenticator (or a concurrent verify racing the UPDATE) presents a counter
 * at or below the stored value — the spec's clone signal — and the storage-layer guard must
 * refuse to roll the counter backward regardless of caller ordering.
 */
describe('WebauthnCredentialRepository.updateCounter — monotonicity (database)', () => {
  const repository = new WebauthnCredentialRepository();

  async function readStoredCounter(credentialId: string): Promise<number | undefined> {
    const rows = await database
      .select({ counter: webauthn_credentials.counter })
      .from(webauthn_credentials)
      .where(eq(webauthn_credentials.credential_id, credentialId));
    return rows[0]?.counter;
  }

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('rejects a counter regression and accepts a strict increase', async () => {
    const user = await createTestUser();
    await repository.createCredential({
      user_id: user.id,
      credential_id: 'cred-regression',
      public_key: 'pk-regression',
      counter: 10,
      device_type: 'singleDevice',
      backed_up: false,
      transports: ['internal'],
    });

    // Cloned authenticator / racing verify presents a lower counter -> must be rejected,
    // leaving the stored counter at 10.
    await repository.updateCounter('cred-regression', 5);
    expect(await readStoredCounter('cred-regression')).toBe(10);

    // An equal counter (10 -> 10) is also a regression for a non-zero credential -> rejected.
    await repository.updateCounter('cred-regression', 10);
    expect(await readStoredCounter('cred-regression')).toBe(10);

    // A strictly-increasing counter is accepted.
    await repository.updateCounter('cred-regression', 11);
    expect(await readStoredCounter('cred-regression')).toBe(11);
  });

  it('accepts the 0 -> 0 no-op write for zero-counter authenticators (passkeys / Windows Hello)', async () => {
    const user = await createTestUser({ email: 'webauthn-zero-counter@example.com' });
    await repository.createCredential({
      user_id: user.id,
      credential_id: 'cred-zero',
      public_key: 'pk-zero',
      counter: 0,
      device_type: 'multiDevice',
      backed_up: true,
      transports: ['internal'],
    });

    // Passkeys keep counter=0 forever; the 0 -> 0 write must be accepted so the credential is
    // not locked out of every subsequent login.
    await repository.updateCounter('cred-zero', 0);
    expect(await readStoredCounter('cred-zero')).toBe(0);
  });

  it('does not touch a revoked credential', async () => {
    const user = await createTestUser({ email: 'webauthn-revoked@example.com' });
    await repository.createCredential({
      user_id: user.id,
      credential_id: 'cred-revoked',
      public_key: 'pk-revoked',
      counter: 3,
      device_type: 'singleDevice',
      backed_up: false,
      transports: ['internal'],
    });
    await database
      .update(webauthn_credentials)
      .set({ revoked_at: new Date() })
      .where(eq(webauthn_credentials.credential_id, 'cred-revoked'));

    // A strict increase that would otherwise be accepted must be ignored once revoked.
    await repository.updateCounter('cred-revoked', 9);
    expect(await readStoredCounter('cred-revoked')).toBe(3);
  });
});
