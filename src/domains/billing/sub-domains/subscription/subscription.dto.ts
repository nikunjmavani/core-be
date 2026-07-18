import { z } from 'zod';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import { trimmedString, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for the `:subscription_id` path param (get/update/change-plan/cancel/resume). */
export const subscriptionIdParamsDto = z
  .object({
    subscription_id: trimmedStringMinMax(1, 28),
  })
  .strict();

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

/**
 * Zod schema for the `GET /api/v1/billing/invoices` cursor pagination query. Invoices are proxied
 * from Stripe, so `after` is a Stripe invoice id (`in_*`) fed to Stripe's `starting_after`, and
 * `limit` is capped at Stripe's page maximum (MAX_LIMIT = 100).
 *
 * @remarks
 * `limit` is `.optional()` (not `.default`) so the OpenAPI query param stays optional — these
 * params are newly added to a pre-existing route, and a defaulted param serializes as `required`,
 * which is a breaking contract change. The default is applied in the service instead.
 */
export const listInvoicesQueryDto = z
  .object({
    after: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).optional(),
  })
  .strict();

/** Validated query inferred from {@link listInvoicesQueryDto}. */
export type ListInvoicesQueryInput = z.infer<typeof listInvoicesQueryDto>;
