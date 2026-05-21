import { ValidationError } from '@/shared/errors/index.js';
import {
  PutNotificationPreferencesDto,
  type PutNotificationPreferencesInput,
} from './user-notification-preferences.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

export function validatePutUserNotificationPreferences(
  body: unknown,
): PutNotificationPreferencesInput {
  const result = PutNotificationPreferencesDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}
