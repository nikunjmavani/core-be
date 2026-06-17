import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { getPlanParamsDto, type GetPlanParamsInput } from './plan.dto.js';

/**
 * Validates path params for `GET /api/v1/plans/:plan_id`, throwing
 * `ValidationError` with field-level details on failure.
 */
export function validateGetPlanParams(params: unknown): GetPlanParamsInput {
  return parseWithSchema(getPlanParamsDto, params);
}
