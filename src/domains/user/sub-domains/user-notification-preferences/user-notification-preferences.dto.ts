import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

export const PutNotificationPreferencesDto = z
  .object({
    preferences: z.array(
      z
        .object({
          notification_type: trimmedString().max(50),
          channel: trimmedString().max(20),
          organization_id: z.number().nullable().optional(),
          is_enabled: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export type PutNotificationPreferencesInput = z.infer<typeof PutNotificationPreferencesDto>;
