import { ValidationError } from '@/shared/errors/index.js';
import { dataExportIdParamDto } from '@/domains/user/sub-domains/user-data-export/user-data-export.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

/**
 * Validate the `:data_export_id` path param for `GET /users/me/data-export/:data_export_id`.
 * Throws {@link ValidationError} (`errors:invalidInput`) with field-level issues when the id is
 * missing or longer than the public-id allowance.
 */
export function validateDataExportIdParam(data: unknown): { data_export_id: string } {
  const parsed = dataExportIdParamDto.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      undefined,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
