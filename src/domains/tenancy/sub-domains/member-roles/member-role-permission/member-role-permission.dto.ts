import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const putMemberRolePermissionsDto = z
  .object({
    permission_codes: z.array(trimmedStringMinMax(1, 100)).min(0),
  })
  .strict();

export type PutMemberRolePermissionsInput = z.infer<typeof putMemberRolePermissionsDto>;
