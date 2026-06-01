import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  updateOrganizationSettingsDto,
  type UpdateOrganizationSettingsInput,
} from './organization-settings.dto.js';

/** Parses raw `PATCH /organizations/:id/settings` body via {@link updateOrganizationSettingsDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationSettings(data: unknown): UpdateOrganizationSettingsInput {
  const result = updateOrganizationSettingsDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
