import { z } from 'zod';

export const updateOrganizationSettingsDto = z
  .object({
    is_email_notifications_enabled: z.boolean().optional(),
    default_locale: z.enum(['en', 'es']).optional(),
    security_policy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsDto>;
