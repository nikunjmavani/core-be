import { ValidationError } from '@/shared/errors/index.js';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';

export function validatePublicIdParam(value: string, fieldName: string): string {
  if (!PUBLIC_ID_REGEX.test(value)) {
    throw new ValidationError('errors:invalidInput', undefined, {
      [fieldName]: ['Must be a valid public id'],
    });
  }
  return value;
}
