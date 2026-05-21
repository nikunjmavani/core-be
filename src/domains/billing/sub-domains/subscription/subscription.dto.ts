import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

export const CreateSubscriptionDto = z
  .object({
    plan_id: trimmedString().max(255),
    billing_cycle: z.enum(['monthly', 'yearly']),
    trial_end: z.string().trim().datetime().optional(),
  })
  .strict();

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionDto>;

export const UpdateSubscriptionDto = z
  .object({
    cancel_at_period_end: z.boolean().optional(),
  })
  .strict();

export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionDto>;

export const ChangePlanDto = z
  .object({
    plan_id: trimmedString().max(255),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof ChangePlanDto>;
