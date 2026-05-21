import { eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { user_notification_preferences } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.schema.js';

export type PreferenceRow = {
  notification_type: string;
  channel: string;
  organization_id: number | null;
  is_enabled: boolean;
};

export class UserNotificationPreferencesRepository {
  async listByUserId(user_id: number) {
    return getRequestDatabase()
      .select()
      .from(user_notification_preferences)
      .where(eq(user_notification_preferences.user_id, user_id));
  }

  async replaceAll(user_id: number, preferences: PreferenceRow[], created_by_user_id?: number) {
    await getRequestDatabase()
      .delete(user_notification_preferences)
      .where(eq(user_notification_preferences.user_id, user_id));
    if (preferences.length === 0) return [];
    const rows = await getRequestDatabase()
      .insert(user_notification_preferences)
      .values(
        preferences.map((preference) => ({
          user_id,
          organization_id: preference.organization_id ?? undefined,
          notification_type: preference.notification_type,
          channel: preference.channel,
          is_enabled: preference.is_enabled,
          created_by_user_id: created_by_user_id ?? undefined,
        })),
      )
      .returning();
    return rows;
  }
}
