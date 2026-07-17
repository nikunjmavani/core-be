import { z } from 'zod';
import { listSearchSortSchema } from '@/shared/utils/http/list-query.util.js';
import { trimmedString, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for the `:role_id` path param (get/update/delete role + list/replace role permissions). */
export const roleIdParamsDto = z
  .object({
    role_id: trimmedStringMinMax(1, 28),
  })
  .strict();

/**
 * Zod schema for the `POST /organization/roles` request body.
 *
 * @remarks
 * sec-T3: `is_system` is a server-only flag set by the seeds (`tenancy.bulk.seed.ts`)
 * to mark Admin/Member as immutable. Clients have no legitimate path to set it; the
 * previous schema accepted it from the body so a tenant could mint roles
 * indistinguishable from seeds and bypass the delete-guard. The `.strict()` shape
 * rejects any body that includes the key.
 *
 * Optional `permission_codes` lets a role be created with its permission set in one
 * atomic call (create + assign in a single transaction). When present it is subject to
 * the same caller-can-grant guard as `PUT /roles/:role_id/permissions`; omit it to create
 * a role with no permissions and assign them later via the PUT.
 */
export const createMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100),
    description: trimmedString().max(500).nullable().optional(),
    permission_codes: z.array(trimmedStringMinMax(1, 100)).max(200).optional(),
  })
  .strict();

/**
 * Zod schema for the `PATCH /organization/roles/:role_id` request body.
 * Both `name` and `description` are optional so callers can patch one field at
 * a time.
 */
export const updateMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100).optional(),
    description: trimmedString().max(500).nullable().optional(),
  })
  .strict();

/** Zod schema for the `GET /organization/roles` cursor pagination query. */
export const listMemberRolesQueryDto = listSearchSortSchema(['name', 'created_at'] as const);

/** Validated body inferred from {@link createMemberRoleDto}. */
export type CreateMemberRoleInput = z.infer<typeof createMemberRoleDto>;
/** Validated body inferred from {@link updateMemberRoleDto}. */
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleDto>;
/** Validated query inferred from {@link listMemberRolesQueryDto}. */
export type ListMemberRolesQueryInput = z.infer<typeof listMemberRolesQueryDto>;
