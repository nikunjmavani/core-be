import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import { NOTIFICATION_CHANNELS } from '@/shared/constants/index.js';

/**
 * Zod schema for `POST /api/v1/organizations/:id/notification-policies` —
 * binds a `notification_type` to a `channel` (`EMAIL`/`SMS`/`PUSH`/`IN_APP`)
 * with default-on/mandatory toggles and an optional ISO `muted_until`.
 */
export const createOrganizationNotificationPolicyDto = z
  .object({
    notification_type: trimmedStringMinMax(1, 50),
    channel: z.enum(NOTIFICATION_CHANNELS),
    default_enabled: z.boolean().optional().default(true),
    is_mandatory: z.boolean().optional().default(false),
    muted_until: z.string().trim().pipe(z.iso.datetime()).optional().nullable(),
  })
  .strict();

/**
 * Zod schema for `PATCH /api/v1/organizations/:id/notification-policies/:policyId`.
 * Notification type and channel are immutable; only delivery flags and the
 * mute window can be updated.
 */
export const updateOrganizationNotificationPolicyDto = z
  .object({
    default_enabled: z.boolean().optional(),
    is_mandatory: z.boolean().optional(),
    muted_until: z.string().trim().pipe(z.iso.datetime()).optional().nullable(),
  })
  .strict();

/** DTO inferred from {@link createOrganizationNotificationPolicyDto}. */
export type CreateOrganizationNotificationPolicyInput = z.infer<
  typeof createOrganizationNotificationPolicyDto
>;
/** DTO inferred from {@link updateOrganizationNotificationPolicyDto}. */
export type UpdateOrganizationNotificationPolicyInput = z.infer<
  typeof updateOrganizationNotificationPolicyDto
>;
