import { ValidationError } from '@/shared/errors/index.js';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';

/** Asserts that `value` is a valid public id; throws a {@link ValidationError} naming `fieldName` on failure. */
export function validatePublicIdParam(value: string, fieldName: string): string {
  if (!PUBLIC_ID_REGEX.test(value)) {
    throw new ValidationError('errors:invalidInput', undefined, {
      [fieldName]: [
        'Must be a valid id (entity prefix + 21 lowercase alphanumerics, e.g. org_a1b2c3d4e5f6g7h8i9j0k)',
      ],
    });
  }
  return value;
}
