import type { NotificationPreferenceOutput } from './user-notification-preferences.types.js';

export interface UserNotificationPreferenceRow {
  id: number;
  notification_type: string;
  channel: string;
  organization_id: number | null;
  is_enabled: boolean;
}

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

export function serializeUserNotificationPreferenceList(
  rows: UserNotificationPreferenceRow[],
): NotificationPreferenceOutput[] {
  return rows.map(serializeUserNotificationPreference);
}
