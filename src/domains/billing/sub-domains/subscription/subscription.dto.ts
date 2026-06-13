import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for `POST /api/v1/billing/subscriptions` request body. */
export const CreateSubscriptionDto = z
  .object({
    plan_id: trimmedString().max(255),
    billing_cycle: z.enum(['monthly', 'yearly']),
  })
  .strict();

/** Inferred input type from {@link CreateSubscriptionDto}. */
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionDto>;

/**
 * Zod schema for `PATCH /api/v1/billing/subscriptions/:subscription_id`.
 *
 * @remarks
 * As of sec-B1, the schema is intentionally empty: `cancel_at_period_end` USED to be
 * accepted here, but PATCHing it never called Stripe — the local row would diverge from
 * the provider with no webhook to reconcile it (e.g. PATCH `{cancel_at_period_end:true}`
 * → app reports cancelling → Stripe still charges the next renewal). Clients must now
 * route those toggles through the dedicated `/cancel` and `/resume` endpoints, both of
 * which DO call Stripe. The PATCH endpoint stays for forward-compatibility (future
 * non-billing-state fields) and `.strict()` rejects any unknown key, so a request that
 * still tries `{cancel_at_period_end: ...}` gets a 422 instead of a silent divergence.
 */
export const UpdateSubscriptionDto = z.object({}).strict();

/** Inferred input type from {@link UpdateSubscriptionDto}. */
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionDto>;

/**
 * Zod schema for `POST /api/v1/billing/subscriptions/:subscription_id/change-plan`
 * — accepts the target plan's `public_id`.
 */
export const ChangePlanDto = z
  .object({
    plan_id: trimmedString().max(255),
  })
  .strict();

/** Inferred input type from {@link ChangePlanDto}. */
export type ChangePlanInput = z.infer<typeof ChangePlanDto>;
