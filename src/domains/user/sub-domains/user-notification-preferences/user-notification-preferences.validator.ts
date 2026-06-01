import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  PutNotificationPreferencesDto,
  type PutNotificationPreferencesInput,
} from './user-notification-preferences.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

/**
 * Validate the `PUT /api/v1/users/me/notification-preferences` body against
 * {@link PutNotificationPreferencesDto}. Throws {@link ValidationError} (`errors:invalidInput`)
 * with flattened field errors so the global error handler can translate per-field messages.
 */
export function validatePutUserNotificationPreferences(
  body: unknown,
): PutNotificationPreferencesInput {
  const result = PutNotificationPreferencesDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
