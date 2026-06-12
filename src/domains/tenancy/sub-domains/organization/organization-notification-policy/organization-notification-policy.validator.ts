import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  createOrganizationNotificationPolicyDto,
  updateOrganizationNotificationPolicyDto,
  type CreateOrganizationNotificationPolicyInput,
  type UpdateOrganizationNotificationPolicyInput,
} from './organization-notification-policy.dto.js';

/** Parses raw `POST /organizations/:organization_id/notification-policies` body via {@link createOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganizationNotificationPolicy(
  data: unknown,
): CreateOrganizationNotificationPolicyInput {
  const result = createOrganizationNotificationPolicyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/** Parses raw `PATCH /organizations/:organization_id/notification-policies/:policy_id` body via {@link updateOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationNotificationPolicy(
  data: unknown,
): UpdateOrganizationNotificationPolicyInput {
  const result = updateOrganizationNotificationPolicyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

// sec-T5: `validatePolicyIdParam` (numeric coercion) was removed. The
// `:policy_id` URL segment is now the 21-char `public_id` validated by the
// shared `validatePublicIdParam` helper, in line with every other resource
// in the codebase.
