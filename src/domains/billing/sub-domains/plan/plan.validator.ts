import { ValidationError } from '@/shared/errors/index.js';
import { getPlanParamsDto, type GetPlanParamsInput } from './plan.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

export function validateGetPlanParams(params: unknown): GetPlanParamsInput {
  const result = getPlanParamsDto.safeParse(params);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}
