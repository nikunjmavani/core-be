import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedSlug, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Shared path params for org-scoped routes (`/organizations/:id/...`). */
export const organizationIdParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

export const organizationSlugParamsDto = z
  .object({
    slug: trimmedSlug(),
  })
  .strict();

export const organizationRoleParamsDto = organizationIdParamsDto.extend({
  roleId: trimmedStringMinMax(1, 21),
});

export const organizationApiKeyParamsDto = organizationIdParamsDto.extend({
  apiKeyId: trimmedStringMinMax(1, 21),
});

export const organizationNotificationPolicyParamsDto = organizationIdParamsDto.extend({
  policyId: trimmedStringMinMax(1, 21),
});

export const createOrganizationDto = z
  .object({
    name: trimmedStringMinMax(1, 255),
    slug: trimmedSlug(),
  })
  .strict();

export const updateOrganizationDto = z
  .object({
    name: trimmedStringMinMax(1, 255).optional(),
    slug: trimmedSlug().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  })
  .strict();

export const listOrganizationsQueryDto = cursorPaginationSchema.strict();

export const uploadLogoDto = z
  .object({
    key: trimmedStringMinMax(1, 512).refine((key) => key.startsWith('organization-logos/'), {
      message: 'Key must start with organization-logos/',
    }),
  })
  .strict();

export type OrganizationIdParamsInput = z.infer<typeof organizationIdParamsDto>;
export type OrganizationSlugParamsInput = z.infer<typeof organizationSlugParamsDto>;
export type OrganizationRoleParamsInput = z.infer<typeof organizationRoleParamsDto>;
export type OrganizationApiKeyParamsInput = z.infer<typeof organizationApiKeyParamsDto>;
export type OrganizationNotificationPolicyParamsInput = z.infer<
  typeof organizationNotificationPolicyParamsDto
>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationDto>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationDto>;
export type ListOrganizationsQueryInput = z.infer<typeof listOrganizationsQueryDto>;
export type UploadLogoInput = z.infer<typeof uploadLogoDto>;
