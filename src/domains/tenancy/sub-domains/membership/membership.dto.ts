import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `POST /organizations/:organization_id/memberships` request body.
 * Identifies the user and role by public id and optionally pre-sets the
 * lifecycle `status`.
 */
export const createMembershipDto = z
  .object({
    user_id: trimmedStringMinMax(1, 28),
    role_id: trimmedStringMinMax(1, 28),
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();

/**
 * Zod schema for the `PATCH /organizations/:organization_id/memberships/:membership_id`
 * request body. Only the membership `status` is mutable here.
 */
export const updateMembershipDto = z
  .object({
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();

/** Zod schema for the `GET /organizations/:organization_id/memberships` cursor pagination query. */
export const listMembershipsQueryDto = cursorPaginationSchema.strict();

/**
 * Zod schema for the `POST /organizations/:organization_id/transfer-ownership` request
 * body. `new_owner_user_id` is the target user's public id.
 */
export const transferOwnershipDto = z
  .object({
    new_owner_user_id: trimmedStringMinMax(1, 28),
  })
  .strict();

/** Validated body inferred from {@link createMembershipDto}. */
export type CreateMembershipInput = z.infer<typeof createMembershipDto>;
/** Validated body inferred from {@link updateMembershipDto}. */
export type UpdateMembershipInput = z.infer<typeof updateMembershipDto>;
/** Validated query inferred from {@link listMembershipsQueryDto}. */
export type ListMembershipsQueryInput = z.infer<typeof listMembershipsQueryDto>;
/** Validated body inferred from {@link transferOwnershipDto}. */
export type TransferOwnershipInput = z.infer<typeof transferOwnershipDto>;
