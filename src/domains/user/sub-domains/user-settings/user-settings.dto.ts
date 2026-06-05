import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `PATCH /api/v1/users/me/settings` body. All fields are optional so callers
 * can update one toggle at a time; omitted fields keep their existing or default value (the
 * service performs an upsert merge with the stored row).
 */
export const UpdateUserSettingsDto = z
  .object({
    is_dark_mode_enabled: z.boolean().optional(),
    is_notifications_enabled: z.boolean().optional(),
    language: trimmedString().max(10).optional(),
    preferred_locales: z.array(trimmedString().max(10)).max(10).optional(),
  })
  .strict();

/** Inferred body type from {@link UpdateUserSettingsDto}. */
export type UpdateUserSettingsInput = z.infer<typeof UpdateUserSettingsDto>;
