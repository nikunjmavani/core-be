import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for `POST /api/v1/organizations/:id/api-keys` — requires a
 * human label, 1–50 scope strings, and an optional `expires_in_days`
 * (1–365). The raw secret is generated server-side and returned only once.
 */
export const createOrganizationApiKeyDto = z
  .object({
    name: trimmedStringMinMax(1, 255),
    scopes: z.array(trimmedStringMinMax(1, 100)).min(1).max(50),
    expires_in_days: z.number().int().min(1).max(365).optional().nullable(),
  })
  .strict();

/**
 * Zod schema for `PATCH /api/v1/organizations/:id/api-keys/:apiKeyId` —
 * supports renaming and toggling status between `ACTIVE` and `REVOKED`.
 * Scopes and expiration are immutable; rotate the key to change them.
 */
export const updateOrganizationApiKeyDto = z
  .object({
    name: trimmedStringMinMax(1, 255).optional(),
    status: z.enum(['ACTIVE', 'REVOKED']).optional(),
  })
  .strict();

/** Zod schema for the `GET /api/v1/organizations/:id/api-keys` query string — cursor-based pagination only. */
export const listOrganizationApiKeysQueryDto = cursorPaginationSchema.strict();

/** DTO inferred from {@link createOrganizationApiKeyDto}. */
export type CreateOrganizationApiKeyInput = z.infer<typeof createOrganizationApiKeyDto>;
/** DTO inferred from {@link updateOrganizationApiKeyDto}. */
export type UpdateOrganizationApiKeyInput = z.infer<typeof updateOrganizationApiKeyDto>;
/** DTO inferred from {@link listOrganizationApiKeysQueryDto}. */
export type ListOrganizationApiKeysQueryInput = z.infer<typeof listOrganizationApiKeysQueryDto>;
