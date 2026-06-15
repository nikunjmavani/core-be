import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { getPlanParamsDto, type GetPlanParamsInput } from './plan.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

/**
 * Validates path params for `GET /api/v1/plans/:plan_id`, throwing
 * {@link ValidationError} with field-level details on failure.
 */
export function validateGetPlanParams(params: unknown): GetPlanParamsInput {
  const result = getPlanParamsDto.safeParse(params);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
