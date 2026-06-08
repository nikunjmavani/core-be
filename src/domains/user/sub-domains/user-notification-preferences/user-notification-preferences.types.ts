/**
 * API response shape for a single user notification preference row.
 *
 * @remarks
 * Preferences are addressed by `(notification_type, channel)`; the PUT endpoint replaces
 * the complete set, so no client needs a stable row id. sec-T finding #17 dropped the
 * internal bigserial `id` and bigint `organization_id` from this shape.
 */
export interface NotificationPreferenceOutput {
  notification_type: string;
  channel: string;
  is_enabled: boolean;
}
