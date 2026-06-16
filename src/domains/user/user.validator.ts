import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
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

/** Validate the `PATCH /api/v1/users/me` body against {@link UpdateMeDto}; throws `ValidationError` on failure. */
export function validateUpdateMe(body: unknown): UpdateMeInput {
  return parseWithSchema(UpdateMeDto, body);
}

/**
 * Validate the admin `GET /api/v1/users` query string. Rejects legacy
 * `page`/`offset` params with a typed error before Zod parses the query.
 */
export function validateListUsers(query: unknown): ListUsersInput {
  return parseCursorPaginatedQuery(ListUsersDto, query);
}

/** Validate the admin `PATCH /api/v1/users/:user_id` body against {@link AdminUpdateUserDto}. */
export function validateAdminUpdateUser(body: unknown): AdminUpdateUserInput {
  return parseWithSchema(AdminUpdateUserDto, body);
}

/** Validate the `PUT /api/v1/users/me/avatar` body against {@link UploadAvatarDto}. */
export function validateUploadAvatar(body: unknown): UploadAvatarInput {
  return parseWithSchema(UploadAvatarDto, body);
}
