import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { UpdateUserSettingsDto, type UpdateUserSettingsInput } from './user-settings.dto.js';

/**
 * Validate the `PATCH /api/v1/users/me/settings` body against {@link UpdateUserSettingsDto}.
 * Throws `ValidationError` (`errors:invalidInput`) with flattened field errors on failure.
 */
export function validateUpdateUserSettings(body: unknown): UpdateUserSettingsInput {
  return parseWithSchema(UpdateUserSettingsDto, body);
}
