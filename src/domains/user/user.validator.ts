import type { ZodType } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import {
  UpdateMeDto,
  ListUsersDto,
  AdminUpdateUserDto,
  UploadAvatarDto,
  type UpdateMeInput,
  type ListUsersInput,
  type AdminUpdateUserInput,
  type UploadAvatarInput,
} from './user.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

function parseWithSchema<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

export function validateUpdateMe(body: unknown): UpdateMeInput {
  return parseWithSchema(UpdateMeDto, body);
}

export function validateListUsers(query: unknown): ListUsersInput {
  ensureCursorOnlyPagination(query);
  return parseWithSchema(ListUsersDto, query);
}

export function validateAdminUpdateUser(body: unknown): AdminUpdateUserInput {
  return parseWithSchema(AdminUpdateUserDto, body);
}

export function validateUploadAvatar(body: unknown): UploadAvatarInput {
  return parseWithSchema(UploadAvatarDto, body);
}
