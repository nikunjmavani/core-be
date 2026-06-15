import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema validating the path params for `GET /api/v1/plans/:plan_id`. */
export const getPlanParamsDto = z
  .object({
    plan_id: trimmedStringMinMax(1, 28),
  })
  .strict();

/** Inferred type from {@link getPlanParamsDto}. */
export type GetPlanParamsInput = z.infer<typeof getPlanParamsDto>;
