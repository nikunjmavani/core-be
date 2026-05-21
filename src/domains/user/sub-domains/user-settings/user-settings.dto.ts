import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

export const UpdateUserSettingsDto = z
  .object({
    is_dark_mode_enabled: z.boolean().optional(),
    is_notifications_enabled: z.boolean().optional(),
    language: trimmedString().max(10).optional(),
    preferred_locales: z.array(trimmedString().max(10)).optional(),
  })
  .strict();

export type UpdateUserSettingsInput = z.infer<typeof UpdateUserSettingsDto>;
