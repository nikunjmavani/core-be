import { and, eq, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { webauthn_credentials } from './webauthn-credential.schema.js';

/** Drizzle row type inferred from {@link webauthn_credentials}; used by the WebAuthn service when reading stored passkeys. */
export type WebauthnCredentialRow = typeof webauthn_credentials.$inferSelect;

/**
 * Drizzle repository for {@link webauthn_credentials}; tracks signature counter monotonicity via
 * {@link updateCounter} and revokes via `revoked_at` (partial unique index keeps `credential_id`
 * reusable after revocation). `auth.webauthn_credentials` is FORCE RLS keyed on
 * `app.current_user_id`, so every method reads/writes via the request-scoped handle and callers
 * must run inside `withUserDatabaseContext` (the owning user public id is always known at the call
 * site — authenticated request or WebAuthn challenge).
 */
export class WebauthnCredentialRepository {
  async listActiveByUserId(userId: number): Promise<WebauthnCredentialRow[]> {
    return getRequestDatabase()
      .select()
      .from(webauthn_credentials)
      .where(
        and(eq(webauthn_credentials.user_id, userId), isNull(webauthn_credentials.revoked_at)),
      );
  }

  async findActiveByCredentialId(credentialId: string): Promise<WebauthnCredentialRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(webauthn_credentials)
      .where(
        and(
          eq(webauthn_credentials.credential_id, credentialId),
          isNull(webauthn_credentials.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createCredential(data: {
    user_id: number;
    credential_id: string;
    public_key: string;
    counter: number;
    device_type: string;
    backed_up: boolean;
    transports: string[];
  }): Promise<WebauthnCredentialRow> {
    const rows = await getRequestDatabase()
      .insert(webauthn_credentials)
      .values({
        user_id: data.user_id,
        credential_id: data.credential_id,
        public_key: data.public_key,
        counter: data.counter,
        device_type: data.device_type,
        backed_up: data.backed_up,
        transports: data.transports,
      })
      .returning();
    return rows[0]!;
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await getRequestDatabase()
      .update(webauthn_credentials)
      .set({
        counter,
        last_used_at: databaseNowTimestamp,
      })
      .where(
        and(
          eq(webauthn_credentials.credential_id, credentialId),
          isNull(webauthn_credentials.revoked_at),
        ),
      );
  }

  async revokeByUserId(userId: number, credentialDatabaseId: number): Promise<void> {
    await getRequestDatabase()
      .update(webauthn_credentials)
      .set({ revoked_at: databaseNowTimestamp })
      .where(
        and(
          eq(webauthn_credentials.id, credentialDatabaseId),
          eq(webauthn_credentials.user_id, userId),
          isNull(webauthn_credentials.revoked_at),
        ),
      );
  }
}
