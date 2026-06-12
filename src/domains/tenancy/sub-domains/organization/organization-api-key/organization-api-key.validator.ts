import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import {
  createOrganizationApiKeyDto,
  updateOrganizationApiKeyDto,
  listOrganizationApiKeysQueryDto,
  type CreateOrganizationApiKeyInput,
  type UpdateOrganizationApiKeyInput,
  type ListOrganizationApiKeysQueryInput,
} from './organization-api-key.dto.js';

/** Parses raw `POST /organizations/:organization_id/api-keys` body via {@link createOrganizationApiKeyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganizationApiKey(data: unknown): CreateOrganizationApiKeyInput {
  const result = createOrganizationApiKeyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/** Parses raw `PATCH /organizations/:organization_id/api-keys/:api_key_id` body via {@link updateOrganizationApiKeyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationApiKey(data: unknown): UpdateOrganizationApiKeyInput {
  const result = updateOrganizationApiKeyDto.safeParse(data);
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
 * Validates the `GET /organizations/:organization_id/api-keys` query string — first
 * rejects legacy `page` / `per_page` keys, then parses with
 * {@link listOrganizationApiKeysQueryDto}. Throws
 * `ValidationError('errors:validation.invalidPagination')` on failure.
 */
export function validateListOrganizationApiKeysQuery(
  data: unknown,
): ListOrganizationApiKeysQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listOrganizationApiKeysQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
