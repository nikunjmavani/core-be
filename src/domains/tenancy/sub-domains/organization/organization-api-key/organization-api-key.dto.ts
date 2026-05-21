import { z } from 'zod';
import { cursorListQuerySchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const createOrganizationApiKeyDto = z
  .object({
    name: trimmedStringMinMax(1, 255),
    scopes: z.array(trimmedStringMinMax(1, 100)).min(1).max(50),
    expires_in_days: z.number().int().min(1).max(365).optional().nullable(),
  })
  .strict();

export const updateOrganizationApiKeyDto = z
  .object({
    name: trimmedStringMinMax(1, 255).optional(),
    status: z.enum(['ACTIVE', 'REVOKED']).optional(),
  })
  .strict();

export const listOrganizationApiKeysQueryDto = cursorListQuerySchema;

export type CreateOrganizationApiKeyInput = z.infer<typeof createOrganizationApiKeyDto>;
export type UpdateOrganizationApiKeyInput = z.infer<typeof updateOrganizationApiKeyDto>;
export type ListOrganizationApiKeysQueryInput = z.infer<typeof listOrganizationApiKeysQueryDto>;
