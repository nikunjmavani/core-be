import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const getPlanParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

export type GetPlanParamsInput = z.infer<typeof getPlanParamsDto>;
