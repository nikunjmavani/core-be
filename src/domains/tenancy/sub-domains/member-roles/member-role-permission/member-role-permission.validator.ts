import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  putMemberRolePermissionsDto,
  type PutMemberRolePermissionsInput,
} from './member-role-permission.dto.js';

/**
 * Validates a `PUT /organization/roles/:role_id/permissions` body against
 * {@link putMemberRolePermissionsDto}, throwing `ValidationError` (i18n key
 * `errors:invalidInput`) with per-field details on failure.
 */
export function validatePutMemberRolePermissions(data: unknown): PutMemberRolePermissionsInput {
  const result = putMemberRolePermissionsDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
