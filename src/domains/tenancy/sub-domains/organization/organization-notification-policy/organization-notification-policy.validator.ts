import { ValidationError } from '@/shared/errors/index.js';
import {
  createOrganizationNotificationPolicyDto,
  updateOrganizationNotificationPolicyDto,
  type CreateOrganizationNotificationPolicyInput,
  type UpdateOrganizationNotificationPolicyInput,
} from './organization-notification-policy.dto.js';

/** Parses raw `POST /organizations/:id/notification-policies` body via {@link createOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganizationNotificationPolicy(
  data: unknown,
): CreateOrganizationNotificationPolicyInput {
  const result = createOrganizationNotificationPolicyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/** Parses raw `PATCH /organizations/:id/notification-policies/:policyId` body via {@link updateOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationNotificationPolicy(
  data: unknown,
): UpdateOrganizationNotificationPolicyInput {
  const result = updateOrganizationNotificationPolicyDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Coerces the `:policyId` path param to a positive integer. Throws
 * `ValidationError('errors:validation.invalidPolicyId')` for non-integer or
 * non-positive values.
 */
export function validatePolicyIdParam(policyId: string): number {
  const policyIdNumber = Number(policyId);
  if (!Number.isInteger(policyIdNumber) || policyIdNumber < 1) {
    throw new ValidationError('errors:validation.invalidPolicyId', undefined, {
      policyId: ['Must be a positive integer'],
    });
  }
  return policyIdNumber;
}
