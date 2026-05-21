import { ValidationError } from '@/shared/errors/index.js';
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

export function validateCreateOrganization(data: unknown): CreateOrganizationInput {
  const result = createOrganizationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateOrganization(data: unknown): UpdateOrganizationInput {
  const result = updateOrganizationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateListOrganizationsQuery(data: unknown): ListOrganizationsQueryInput {
  const result = listOrganizationsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

export function validateUploadLogo(data: unknown): UploadLogoInput {
  const result = uploadLogoDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
