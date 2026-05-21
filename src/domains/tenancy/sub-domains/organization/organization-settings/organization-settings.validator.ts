import { ValidationError } from '@/shared/errors/index.js';
import {
  updateOrganizationSettingsDto,
  type UpdateOrganizationSettingsInput,
} from './organization-settings.dto.js';

export function validateUpdateOrganizationSettings(data: unknown): UpdateOrganizationSettingsInput {
  const result = updateOrganizationSettingsDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
