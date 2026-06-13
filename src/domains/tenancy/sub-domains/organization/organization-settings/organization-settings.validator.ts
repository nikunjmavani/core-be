import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  PROTO_POLLUTION_KEYS,
  updateOrganizationSettingsDto,
  type UpdateOrganizationSettingsInput,
} from './organization-settings.dto.js';

/**
 * Rejects an explicit prototype-pollution key on `security_policy` from the RAW body, before Zod
 * (which silently drops `__proto__` during record reconstruction). Scans own keys so a
 * `JSON.parse`-created `__proto__` own property is seen (route-audit C4).
 */
function assertSecurityPolicyHasNoPollutionKeys(data: unknown): void {
  if (data === null || typeof data !== 'object') return;
  const securityPolicy = (data as Record<string, unknown>).security_policy;
  if (securityPolicy === null || typeof securityPolicy !== 'object') return;
  for (const key of Reflect.ownKeys(securityPolicy)) {
    if (typeof key === 'string' && PROTO_POLLUTION_KEYS.has(key)) {
      throw new ValidationError('errors:invalidInput', undefined, {
        security_policy: [
          'security_policy: keys __proto__, constructor, and prototype are not allowed',
        ],
      });
    }
  }
}

/** Parses raw `PATCH /organization/settings` body via {@link updateOrganizationSettingsDto}; throws `ValidationError('errors:invalidInput')` on failure. */
export function validateUpdateOrganizationSettings(data: unknown): UpdateOrganizationSettingsInput {
  assertSecurityPolicyHasNoPollutionKeys(data);
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
