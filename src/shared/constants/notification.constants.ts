/**
 * Canonical notification delivery channels.
 *
 * Single source of truth for the values enforced by the `chk_org_notif_channel`
 * and `chk_user_notif_prefs_channel` database check constraints. DTOs validate
 * against this list so an invalid channel is rejected as a 422 at the edge,
 * rather than slipping through to the database and surfacing the check
 * violation as an opaque 500.
 */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WEB_PUSH', 'IN_APP'] as const;

/** A delivery channel accepted by notification preference / policy endpoints. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Canonical notification-type vocabulary — a single source of truth shared by the surfaces that
 * key notifications: user notification preferences, organization notification policies, and the
 * emitted in-app notifications (via the bulk seeder today; the live dispatch path when wired).
 *
 * Types are namespaced `domain.event`. DTOs validate `notification_type` against this list so an
 * unknown type is rejected as a 422 at the edge (mirroring `NOTIFICATION_CHANNELS`), keeping the
 * three surfaces on one vocabulary — a prerequisite for a preference to ever gate a delivery.
 */
export const NOTIFICATION_TYPES = [
  'system.welcome',
  'system.maintenance',
  'security.alert',
  'billing.usage_threshold',
  'billing.payment_succeeded',
  'billing.payment_failed',
  'membership.invite_accepted',
  'subscription.updated',
  'webhook.delivery_failed',
] as const;

/** A notification type accepted by notification preference / policy endpoints. */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Maximum rows a single `markAllReadForUser` UPDATE touches before looping
 * (audit #39). Bounds the lock footprint and the RETURNING id set so a user with
 * a very large unread backlog cannot turn "mark all read" into one unbounded,
 * long-held write that blocks concurrent notification inserts for that user.
 */
export const NOTIFICATION_MARK_ALL_READ_BATCH_SIZE = 1000;
