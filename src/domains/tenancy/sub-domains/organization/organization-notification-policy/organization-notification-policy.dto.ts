import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const createOrganizationNotificationPolicyDto = z
  .object({
    notification_type: trimmedStringMinMax(1, 50),
    channel: trimmedStringMinMax(1, 20),
    default_enabled: z.boolean().optional().default(true),
    is_mandatory: z.boolean().optional().default(false),
    muted_until: z.string().trim().datetime().optional().nullable(),
  })
  .strict();

export const updateOrganizationNotificationPolicyDto = z
  .object({
    default_enabled: z.boolean().optional(),
    is_mandatory: z.boolean().optional(),
    muted_until: z.string().trim().datetime().optional().nullable(),
  })
  .strict();

export type CreateOrganizationNotificationPolicyInput = z.infer<
  typeof createOrganizationNotificationPolicyDto
>;
export type UpdateOrganizationNotificationPolicyInput = z.infer<
  typeof updateOrganizationNotificationPolicyDto
>;
