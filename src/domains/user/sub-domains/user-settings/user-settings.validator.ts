import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { UpdateUserSettingsDto, type UpdateUserSettingsInput } from './user-settings.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

/**
 * Validate the `PATCH /api/v1/users/me/settings` body against {@link UpdateUserSettingsDto}.
 * Throws {@link ValidationError} (`errors:invalidInput`) with flattened field errors on failure.
 */
export function validateUpdateUserSettings(body: unknown): UpdateUserSettingsInput {
  const result = UpdateUserSettingsDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
