import { eq } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { user_settings } from '@/domains/user/sub-domains/user-settings/user-settings.schema.js';

/**
 * Drizzle data-access for `auth.user_settings`. Implements an upsert-merge for the singleton
 * row keyed by `user_id`: missing fields fall back to the existing row, then to the platform
 * factory defaults (light mode, notifications on, `en` language, `['en']` preferred locales).
 */
export class UserSettingsRepository {
  async getByUserId(user_id: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(user_settings)
      .where(eq(user_settings.user_id, user_id))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(
    user_id: number,
    data: {
      is_dark_mode_enabled?: boolean;
      is_notifications_enabled?: boolean;
      language?: string;
      preferred_locales?: unknown;
    },
  ) {
    const existing = await this.getByUserId(user_id);
    const payload = {
      is_dark_mode_enabled: data.is_dark_mode_enabled ?? existing?.is_dark_mode_enabled ?? false,
      is_notifications_enabled:
        data.is_notifications_enabled ?? existing?.is_notifications_enabled ?? true,
      language: data.language ?? existing?.language ?? 'en',
      preferred_locales: (data.preferred_locales as string[] | undefined) ??
        (existing?.preferred_locales as string[] | undefined) ?? ['en'],
      updated_at: databaseNowTimestamp,
    };
    if (existing) {
      const rows = await getRequestDatabase()
        .update(user_settings)
        .set(payload)
        .where(eq(user_settings.user_id, user_id))
        .returning();
      return rows[0]!;
    }
    const rows = await getRequestDatabase()
      .insert(user_settings)
      .values({
        user_id,
        is_dark_mode_enabled: payload.is_dark_mode_enabled,
        is_notifications_enabled: payload.is_notifications_enabled,
        language: payload.language,
        preferred_locales: payload.preferred_locales,
      })
      .returning();
    return rows[0]!;
  }
}
