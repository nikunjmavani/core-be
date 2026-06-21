import { eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { DEFAULT_REPOSITORY_LIST_LIMIT } from '@/shared/constants/query-limits.constants.js';
import { capListWithWarning } from '@/shared/utils/infrastructure/list-cap.util.js';
import { user_notification_preferences } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.schema.js';

/** Insert payload accepted by {@link UserNotificationPreferencesRepository.replaceAll}. */
export type PreferenceRow = {
  notification_type: string;
  channel: string;
  organization_id: number | null;
  is_enabled: boolean;
};

/**
 * Drizzle data-access for `auth.user_notification_preferences`. Implements the replace-all cascade:
 * `replaceAll` deletes every row for the user and re-inserts the supplied list within the request's
 * (RLS-bound) database scope so the user can only mutate their own preferences.
 */
export class UserNotificationPreferencesRepository {
  async listByUserId(user_id: number) {
    // audit #36: bound this user-self-scoped read with limit+1 + capListWithWarning (the preference
    // matrix is small, but this enforces a hard ceiling and surfaces an alert if it is ever hit).
    const rows = await getRequestDatabase()
      .select()
      .from(user_notification_preferences)
      .where(eq(user_notification_preferences.user_id, user_id))
      .limit(DEFAULT_REPOSITORY_LIST_LIMIT + 1);
    return capListWithWarning({
      rows,
      limit: DEFAULT_REPOSITORY_LIST_LIMIT,
      resource: 'user.user_notification_preferences',
      context: { userId: user_id },
    });
  }

  async replaceAll(user_id: number, preferences: PreferenceRow[], created_by_user_id?: number) {
    await getRequestDatabase()
      .delete(user_notification_preferences)
      .where(eq(user_notification_preferences.user_id, user_id));
    if (preferences.length === 0) return [];
    // audit-#11: collapse duplicate (notification_type, channel) tuples — last
    // occurrence wins — so the idx_user_notif_prefs_user_type_channel_unique index
    // cannot be tripped by a payload that repeats a tuple.
    const deduplicatedPreferences = Array.from(
      new Map(
        preferences.map((preference) => [
          `${preference.notification_type} ${preference.channel}`,
          preference,
        ]),
      ).values(),
    );
    const rows = await getRequestDatabase()
      .insert(user_notification_preferences)
      .values(
        deduplicatedPreferences.map((preference) => ({
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
