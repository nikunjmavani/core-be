import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
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
  const result = createOrganizationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/** Parses raw `PATCH /organization` body via {@link updateOrganizationDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganization(data: unknown): UpdateOrganizationInput {
  const result = updateOrganizationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Validates the `GET /organizations` query string — first rejects legacy
 * `page` / `per_page` keys (`ensureCursorOnlyPagination`), then parses with
 * {@link listOrganizationsQueryDto}. Throws
 * `ValidationError('errors:validation.invalidPagination')` on failure.
 */
export function validateListOrganizationsQuery(data: unknown): ListOrganizationsQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listOrganizationsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/** Parses raw `PUT /organization/logo` body via {@link uploadLogoDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUploadLogo(data: unknown): UploadLogoInput {
  const result = uploadLogoDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
