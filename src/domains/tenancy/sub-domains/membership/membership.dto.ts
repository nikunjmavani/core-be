import { z } from 'zod';
import { cursorListQuerySchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const createMembershipDto = z
  .object({
    user_id: trimmedStringMinMax(1, 21),
    role_id: trimmedStringMinMax(1, 21),
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();

export const updateMembershipDto = z
  .object({
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();

export const listMembershipsQueryDto = cursorListQuerySchema;

export const transferOwnershipDto = z
  .object({
    new_owner_user_id: trimmedStringMinMax(1, 21),
  })
  .strict();

export type CreateMembershipInput = z.infer<typeof createMembershipDto>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipDto>;
export type ListMembershipsQueryInput = z.infer<typeof listMembershipsQueryDto>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipDto>;
