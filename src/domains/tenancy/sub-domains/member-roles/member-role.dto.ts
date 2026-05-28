import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for the `POST /organizations/:id/roles` request body. */
export const createMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100),
    description: trimmedString().max(500).nullable().optional(),
    is_system: z.boolean().optional(),
  })
  .strict();

/**
 * Zod schema for the `PATCH /organizations/:id/roles/:roleId` request body.
 * Both `name` and `description` are optional so callers can patch one field at
 * a time.
 */
export const updateMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100).optional(),
    description: trimmedString().max(500).nullable().optional(),
  })
  .strict();

/** Zod schema for the `GET /organizations/:id/roles` cursor pagination query. */
export const listMemberRolesQueryDto = cursorPaginationSchema.strict();

/** Validated body inferred from {@link createMemberRoleDto}. */
export type CreateMemberRoleInput = z.infer<typeof createMemberRoleDto>;
/** Validated body inferred from {@link updateMemberRoleDto}. */
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleDto>;
/** Validated query inferred from {@link listMemberRolesQueryDto}. */
export type ListMemberRolesQueryInput = z.infer<typeof listMemberRolesQueryDto>;
