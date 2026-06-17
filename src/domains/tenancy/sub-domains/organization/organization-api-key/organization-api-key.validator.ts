import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
import {
  createOrganizationApiKeyDto,
  updateOrganizationApiKeyDto,
  listOrganizationApiKeysQueryDto,
  type CreateOrganizationApiKeyInput,
  type UpdateOrganizationApiKeyInput,
  type ListOrganizationApiKeysQueryInput,
} from './organization-api-key.dto.js';

/** Parses raw `POST /organization/api-keys` body via {@link createOrganizationApiKeyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganizationApiKey(data: unknown): CreateOrganizationApiKeyInput {
  return parseWithSchema(createOrganizationApiKeyDto, data);
}

/** Parses raw `PATCH /organization/api-keys/:api_key_id` body via {@link updateOrganizationApiKeyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationApiKey(data: unknown): UpdateOrganizationApiKeyInput {
  return parseWithSchema(updateOrganizationApiKeyDto, data);
}

/**
 * Validates the `GET /organization/api-keys` query string — first
 * rejects legacy `page` / `per_page` keys, then parses with
 * {@link listOrganizationApiKeysQueryDto}. Throws
 * `ValidationError('errors:validation.invalidPagination')` on failure.
 */
export function validateListOrganizationApiKeysQuery(
  data: unknown,
): ListOrganizationApiKeysQueryInput {
  return parseCursorPaginatedQuery(
    listOrganizationApiKeysQueryDto,
    data,
    'errors:validation.invalidPagination',
  );
}
