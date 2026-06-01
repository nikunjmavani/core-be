import { z } from 'zod';

/**
 * Zod schema for `PATCH /api/v1/organizations/:id/settings`. All fields are
 * optional (PATCH semantics); `default_locale` is constrained to the
 * locales the API actually translates (`en`, `es`); `security_policy` is a
 * free-form record persisted as JSONB.
 */
export const updateOrganizationSettingsDto = z
  .object({
    is_email_notifications_enabled: z.boolean().optional(),
    default_locale: z.enum(['en', 'es']).optional(),
    security_policy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** DTO inferred from {@link updateOrganizationSettingsDto}. */
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsDto>;
