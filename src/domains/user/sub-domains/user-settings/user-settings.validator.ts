import { ValidationError } from '@/shared/errors/index.js';
import { UpdateUserSettingsDto, type UpdateUserSettingsInput } from './user-settings.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

export function validateUpdateUserSettings(body: unknown): UpdateUserSettingsInput {
  const result = UpdateUserSettingsDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}
