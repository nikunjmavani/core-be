import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema validating the path params for `GET /api/v1/plans/:id`. */
export const getPlanParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

/** Inferred type from {@link getPlanParamsDto}. */
export type GetPlanParamsInput = z.infer<typeof getPlanParamsDto>;
