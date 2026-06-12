import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import {
  createMemberRoleDto,
  updateMemberRoleDto,
  listMemberRolesQueryDto,
} from './member-role.dto.js';
import type {
  CreateMemberRoleInput,
  UpdateMemberRoleInput,
  ListMemberRolesQueryInput,
} from './member-role.dto.js';

/**
 * Validates a `POST /organizations/:organization_id/roles` body against
 * {@link createMemberRoleDto}; throws `ValidationError('errors:invalidInput')`
 * with per-field details on failure.
 */
export function validateCreateMemberRole(data: unknown): CreateMemberRoleInput {
  const result = createMemberRoleDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Validates a `PATCH /organizations/:organization_id/roles/:role_id` body against
 * {@link updateMemberRoleDto}; throws `ValidationError('errors:invalidInput')`
 * with per-field details on failure.
 */
export function validateUpdateMemberRole(data: unknown): UpdateMemberRoleInput {
  const result = updateMemberRoleDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Validates the `GET /organizations/:organization_id/roles` query string, rejecting legacy
 * page-number pagination via {@link ensureCursorOnlyPagination} before parsing
 * against {@link listMemberRolesQueryDto}.
 */
export function validateListMemberRolesQuery(data: unknown): ListMemberRolesQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listMemberRolesQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
