import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
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
  return parseWithSchema(putMemberRolePermissionsDto, data);
}
