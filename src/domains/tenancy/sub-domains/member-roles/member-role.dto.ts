import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `POST /organizations/:id/roles` request body.
 *
 * @remarks
 * sec-T3: `is_system` is a server-only flag set by the seeds (`tenancy.bulk.seed.ts`)
 * to mark Admin/Member as immutable. Clients have no legitimate path to set it; the
 * previous schema accepted it from the body so a tenant could mint roles
 * indistinguishable from seeds and bypass the delete-guard. The `.strict()` shape
 * rejects any body that includes the key.
 */
export const createMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100),
    description: trimmedString().max(500).nullable().optional(),
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
