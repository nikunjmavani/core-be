import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import {
  PutNotificationPreferencesDto,
  type PutNotificationPreferencesInput,
} from './user-notification-preferences.dto.js';

/**
 * Validate the `PUT /api/v1/users/me/notification-preferences` body against
 * {@link PutNotificationPreferencesDto}. Throws `ValidationError` (`errors:invalidInput`)
 * with flattened field errors so the global error handler can translate per-field messages.
 */
export function validatePutUserNotificationPreferences(
  body: unknown,
): PutNotificationPreferencesInput {
  return parseWithSchema(PutNotificationPreferencesDto, body);
}
