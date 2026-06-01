import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedSlug, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Shared path params for org-scoped routes (`/organizations/:id/...`). */
export const organizationIdParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

/** Path params for `/organizations/by-slug/:slug` (URL-friendly organization slug). */
export const organizationSlugParamsDto = z
  .object({
    slug: trimmedSlug(),
  })
  .strict();

/** Path params for member-role routes scoped under an organization (`/organizations/:id/roles/:roleId`). */
export const organizationRoleParamsDto = organizationIdParamsDto.extend({
  roleId: trimmedStringMinMax(1, 21),
});

/** Path params for organization API-key routes (`/organizations/:id/api-keys/:apiKeyId`). */
export const organizationApiKeyParamsDto = organizationIdParamsDto.extend({
  apiKeyId: trimmedStringMinMax(1, 21),
});

/** Path params for notification-policy routes (`/organizations/:id/notification-policies/:policyId`). */
export const organizationNotificationPolicyParamsDto = organizationIdParamsDto.extend({
  policyId: trimmedStringMinMax(1, 21),
});

/** Zod schema for the `POST /api/v1/organizations` request body (name + URL-friendly slug). */
export const createOrganizationDto = z
  .object({
    name: trimmedStringMinMax(1, 255),
    slug: trimmedSlug(),
  })
  .strict();

/**
 * Zod schema for the `PATCH /api/v1/organizations/:id` request body. All
 * fields optional; `status` is constrained to the lifecycle values stored
 * in `tenancy.organizations.status`.
 */
export const updateOrganizationDto = z
  .object({
    name: trimmedStringMinMax(1, 255).optional(),
    slug: trimmedSlug().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  })
  .strict();

/** Zod schema for the `GET /api/v1/organizations` query string — cursor-based pagination only. */
export const listOrganizationsQueryDto = cursorPaginationSchema.strict();

/**
 * Zod schema for the `PUT /api/v1/organizations/:id/logo` request body.
 * Enforces that `key` lives under the `organization-logos/` S3 prefix; the
 * service additionally checks the key belongs to this organization.
 */
export const uploadLogoDto = z
  .object({
    key: trimmedStringMinMax(1, 512).refine((key) => key.startsWith('organization-logos/'), {
      message: 'Key must start with organization-logos/',
    }),
  })
  .strict();

/** DTO inferred from {@link organizationIdParamsDto}. */
export type OrganizationIdParamsInput = z.infer<typeof organizationIdParamsDto>;
/** DTO inferred from {@link organizationSlugParamsDto}. */
export type OrganizationSlugParamsInput = z.infer<typeof organizationSlugParamsDto>;
/** DTO inferred from {@link organizationRoleParamsDto}. */
export type OrganizationRoleParamsInput = z.infer<typeof organizationRoleParamsDto>;
/** DTO inferred from {@link organizationApiKeyParamsDto}. */
export type OrganizationApiKeyParamsInput = z.infer<typeof organizationApiKeyParamsDto>;
/** DTO inferred from {@link organizationNotificationPolicyParamsDto}. */
export type OrganizationNotificationPolicyParamsInput = z.infer<
  typeof organizationNotificationPolicyParamsDto
>;
/** DTO inferred from {@link createOrganizationDto}. */
export type CreateOrganizationInput = z.infer<typeof createOrganizationDto>;
/** DTO inferred from {@link updateOrganizationDto}. */
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationDto>;
/** DTO inferred from {@link listOrganizationsQueryDto}. */
export type ListOrganizationsQueryInput = z.infer<typeof listOrganizationsQueryDto>;
/** DTO inferred from {@link uploadLogoDto}. */
export type UploadLogoInput = z.infer<typeof uploadLogoDto>;
