import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const createMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100),
    description: trimmedString().max(500).nullable().optional(),
    is_system: z.boolean().optional(),
  })
  .strict();

export const updateMemberRoleDto = z
  .object({
    name: trimmedStringMinMax(1, 100).optional(),
    description: trimmedString().max(500).nullable().optional(),
  })
  .strict();

export const listMemberRolesQueryDto = cursorPaginationSchema.strict();

export type CreateMemberRoleInput = z.infer<typeof createMemberRoleDto>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleDto>;
export type ListMemberRolesQueryInput = z.infer<typeof listMemberRolesQueryDto>;
