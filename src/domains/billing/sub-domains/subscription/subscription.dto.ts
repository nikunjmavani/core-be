import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for `POST /api/v1/organizations/:id/subscriptions` request body. */
export const CreateSubscriptionDto = z
  .object({
    plan_id: trimmedString().max(255),
    billing_cycle: z.enum(['monthly', 'yearly']),
  })
  .strict();

/** Inferred input type from {@link CreateSubscriptionDto}. */
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionDto>;

/**
 * Zod schema for `PATCH /api/v1/organizations/:id/subscriptions/:subscriptionId`
 * — currently only the `cancel_at_period_end` toggle is updatable.
 */
export const UpdateSubscriptionDto = z
  .object({
    cancel_at_period_end: z.boolean().optional(),
  })
  .strict();

/** Inferred input type from {@link UpdateSubscriptionDto}. */
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionDto>;

/**
 * Zod schema for `POST /api/v1/organizations/:id/subscriptions/:subscriptionId/change-plan`
 * — accepts the target plan's `public_id`.
 */
export const ChangePlanDto = z
  .object({
    plan_id: trimmedString().max(255),
  })
  .strict();

/** Inferred input type from {@link ChangePlanDto}. */
export type ChangePlanInput = z.infer<typeof ChangePlanDto>;
