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

/** Validate the `PATCH /api/v1/users/me` body against {@link UpdateMeDto}; throws {@link ValidationError} on failure. */
export function validateUpdateMe(body: unknown): UpdateMeInput {
  return parseWithSchema(UpdateMeDto, body);
}

/**
 * Validate the admin `GET /api/v1/users` query string. Calls `ensureCursorOnlyPagination` first
 * so legacy `page`/`offset` params are rejected with a typed error before Zod parses the query.
 */
export function validateListUsers(query: unknown): ListUsersInput {
  ensureCursorOnlyPagination(query);
  return parseWithSchema(ListUsersDto, query);
}

/** Validate the admin `PATCH /api/v1/users/:userId` body against {@link AdminUpdateUserDto}. */
export function validateAdminUpdateUser(body: unknown): AdminUpdateUserInput {
  return parseWithSchema(AdminUpdateUserDto, body);
}

/** Validate the `PUT /api/v1/users/me/avatar` body against {@link UploadAvatarDto}. */
export function validateUploadAvatar(body: unknown): UploadAvatarInput {
  return parseWithSchema(UploadAvatarDto, body);
}
