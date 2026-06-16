import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import {
  createOrganizationNotificationPolicyDto,
  updateOrganizationNotificationPolicyDto,
  type CreateOrganizationNotificationPolicyInput,
  type UpdateOrganizationNotificationPolicyInput,
} from './organization-notification-policy.dto.js';

/** Parses raw `POST /organization/notification-policies` body via {@link createOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateCreateOrganizationNotificationPolicy(
  data: unknown,
): CreateOrganizationNotificationPolicyInput {
  return parseWithSchema(createOrganizationNotificationPolicyDto, data);
}

/** Parses raw `PATCH /organization/notification-policies/:policy_id` body via {@link updateOrganizationNotificationPolicyDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationNotificationPolicy(
  data: unknown,
): UpdateOrganizationNotificationPolicyInput {
  return parseWithSchema(updateOrganizationNotificationPolicyDto, data);
}

// sec-T5: `validatePolicyIdParam` (numeric coercion) was removed. The
// `:policy_id` URL segment is now the 21-char `public_id` validated by the
// shared `validatePublicIdParam` helper, in line with every other resource
// in the codebase.
