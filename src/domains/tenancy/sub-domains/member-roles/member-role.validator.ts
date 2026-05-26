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

export function validateCreateMemberRole(data: unknown): CreateMemberRoleInput {
  const result = createMemberRoleDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateMemberRole(data: unknown): UpdateMemberRoleInput {
  const result = updateMemberRoleDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateListMemberRolesQuery(data: unknown): ListMemberRolesQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listMemberRolesQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}
