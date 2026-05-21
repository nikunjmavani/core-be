import { ValidationError } from '@/shared/errors/index.js';
import { exportIdParamDto } from '@/domains/user/sub-domains/user-data-export/user-data-export.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

export function validateExportIdParam(data: unknown): { exportId: string } {
  const parsed = exportIdParamDto.safeParse(data);
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
