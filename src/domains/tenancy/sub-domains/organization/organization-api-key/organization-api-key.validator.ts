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

export function validateCreateOrganizationApiKey(data: unknown): CreateOrganizationApiKeyInput {
  const result = createOrganizationApiKeyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateOrganizationApiKey(data: unknown): UpdateOrganizationApiKeyInput {
  const result = updateOrganizationApiKeyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateListOrganizationApiKeysQuery(
  data: unknown,
): ListOrganizationApiKeysQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listOrganizationApiKeysQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}
