/**
 * Canonical notification delivery channels.
 *
 * Single source of truth for the values enforced by the `chk_org_notif_channel`
 * and `chk_user_notif_prefs_channel` database check constraints. DTOs validate
 * against this list so an invalid channel is rejected as a 422 at the edge,
 * rather than slipping through to the database and surfacing the check
 * violation as an opaque 500.
 */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP'] as const;

/** A delivery channel accepted by notification preference / policy endpoints. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
