import { and, eq, isNull } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { webauthn_credentials } from './webauthn-credential.schema.js';

export type WebauthnCredentialRow = typeof webauthn_credentials.$inferSelect;

export class WebauthnCredentialRepository {
  async listActiveByUserId(userId: number): Promise<WebauthnCredentialRow[]> {
    return database
      .select()
      .from(webauthn_credentials)
      .where(
        and(eq(webauthn_credentials.user_id, userId), isNull(webauthn_credentials.revoked_at)),
      );
  }

  async findActiveByCredentialId(credentialId: string): Promise<WebauthnCredentialRow | null> {
    const rows = await database
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
    const rows = await database
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
    await database
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
    await database
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
