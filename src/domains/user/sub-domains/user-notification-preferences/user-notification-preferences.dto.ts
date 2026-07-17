import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/shared/constants/index.js';

/**
 * Zod schema for the `PUT /api/v1/users/me/notification-preferences` request body.
 * Replace-all semantics: clients send the complete preference set per `(notification_type, channel,
 * organization_id?)` triple; the service deletes rows for the user and re-inserts this list.
 */
export const PutNotificationPreferencesDto = z
  .object({
    preferences: z
      .array(
        z
          .object({
            notification_type: z.enum(NOTIFICATION_TYPES),
            channel: z.enum(NOTIFICATION_CHANNELS),
            organization_id: z.number().nullable().optional(),
            is_enabled: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/** Inferred body type from {@link PutNotificationPreferencesDto}. */
export type PutNotificationPreferencesInput = z.infer<typeof PutNotificationPreferencesDto>;
