import type { NotificationPreferenceOutput } from './user-notification-preferences.types.js';

/** Minimal row projection accepted by the preference serializers (database row → API output). */
export interface UserNotificationPreferenceRow {
  id: number;
  notification_type: string;
  channel: string;
  organization_id: number | null;
  is_enabled: boolean;
}

/** Project a single preference row into the public {@link NotificationPreferenceOutput} shape. */
export function serializeUserNotificationPreference(
  row: UserNotificationPreferenceRow,
): NotificationPreferenceOutput {
  return {
    id: row.id,
    notification_type: row.notification_type,
    channel: row.channel,
    organization_id: row.organization_id,
    is_enabled: row.is_enabled,
  };
}

/** Project a list of preference rows by mapping {@link serializeUserNotificationPreference}. */
export function serializeUserNotificationPreferenceList(
  rows: UserNotificationPreferenceRow[],
): NotificationPreferenceOutput[] {
  return rows.map(serializeUserNotificationPreference);
}
