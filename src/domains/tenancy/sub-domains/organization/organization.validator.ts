import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
import {
  createOrganizationDto,
  updateOrganizationDto,
  listOrganizationsQueryDto,
  uploadLogoDto,
} from './organization.dto.js';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  ListOrganizationsQueryInput,
  UploadLogoInput,
} from './organization.dto.js';

/** Parses raw `POST /organizations` body via {@link createOrganizationDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganization(data: unknown): CreateOrganizationInput {
  return parseWithSchema(createOrganizationDto, data);
}

/** Parses raw `PATCH /organization` body via {@link updateOrganizationDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganization(data: unknown): UpdateOrganizationInput {
  return parseWithSchema(updateOrganizationDto, data);
}

/**
 * Validates the `GET /organizations` query string — first rejects legacy
 * `page` / `per_page` keys (`ensureCursorOnlyPagination`), then parses with
 * {@link listOrganizationsQueryDto}. Throws
 * `ValidationError('errors:validation.invalidPagination')` on failure.
 */
export function validateListOrganizationsQuery(data: unknown): ListOrganizationsQueryInput {
  return parseCursorPaginatedQuery(
    listOrganizationsQueryDto,
    data,
    'errors:validation.invalidPagination',
  );
}

/** Parses raw `PUT /organization/logo` body via {@link uploadLogoDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUploadLogo(data: unknown): UploadLogoInput {
  return parseWithSchema(uploadLogoDto, data);
}
