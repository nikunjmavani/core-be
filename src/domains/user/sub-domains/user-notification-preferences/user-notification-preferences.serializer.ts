import type { NotificationPreferenceOutput } from './user-notification-preferences.types.js';

/** Minimal row projection accepted by the preference serializers (database row → API output). */
export interface UserNotificationPreferenceRow {
  notification_type: string;
  channel: string;
  is_enabled: boolean;
}

/**
 * Project a single preference row into the public {@link NotificationPreferenceOutput} shape.
 *
 * @remarks
 * sec-T finding #17: drops the internal bigserial `id` and bigint `organization_id` from
 * the API response. Preferences are addressed by `(notification_type, channel)` — the PUT
 * endpoint replaces the full set, so clients never need the row id as a stable identifier.
 * Emitting the bigserial would leak internal user-id enumeration and platform preference
 * volume to any authenticated caller; emitting the raw bigint `organization_id` advertises
 * the internal column type even though the service explicitly rejects non-null inputs.
 */
export function serializeUserNotificationPreference(
  row: UserNotificationPreferenceRow,
): NotificationPreferenceOutput {
  return {
    notification_type: row.notification_type,
    channel: row.channel,
    is_enabled: row.is_enabled,
  };
}

/** Project a list of preference rows by mapping {@link serializeUserNotificationPreference}. */
export function serializeUserNotificationPreferenceList(
  rows: UserNotificationPreferenceRow[],
): NotificationPreferenceOutput[] {
  return rows.map(serializeUserNotificationPreference);
}
