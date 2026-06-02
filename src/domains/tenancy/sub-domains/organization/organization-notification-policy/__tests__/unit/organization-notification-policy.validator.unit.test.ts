import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateCreateOrganizationNotificationPolicy,
  validatePolicyIdParam,
  validateUpdateOrganizationNotificationPolicy,
} from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.validator.js';

describe('organization-notification-policy validators', () => {
  it('validateCreateOrganizationNotificationPolicy accepts type and channel', () => {
    const result = validateCreateOrganizationNotificationPolicy({
      notification_type: 'billing',
      channel: 'EMAIL',
    });
    expect(result.notification_type).toBe('billing');
    expect(result.default_enabled).toBe(true);
    expect(result.is_mandatory).toBe(false);
  });

  it('validateCreateOrganizationNotificationPolicy rejects a channel outside the allowed set', () => {
    // An unknown channel must be a 422 at the edge, not a chk_org_notif_channel 500.
    expect(() =>
      validateCreateOrganizationNotificationPolicy({
        notification_type: 'billing',
        channel: 'CARRIER_PIGEON',
      }),
    ).toThrow(ValidationError);
  });

  it('validateUpdateOrganizationNotificationPolicy accepts partial update', () => {
    expect(validateUpdateOrganizationNotificationPolicy({ default_enabled: false })).toEqual({
      default_enabled: false,
    });
  });

  it('validateCreateOrganizationNotificationPolicy rejects invalid muted_until', () => {
    expect(() =>
      validateCreateOrganizationNotificationPolicy({
        notification_type: 'billing',
        channel: 'EMAIL',
        muted_until: 'not-a-datetime',
      }),
    ).toThrow(ValidationError);
  });

  it('validatePolicyIdParam accepts positive integer strings', () => {
    expect(validatePolicyIdParam('42')).toBe(42);
  });

  it('validatePolicyIdParam rejects zero', () => {
    expect(() => validatePolicyIdParam('0')).toThrow(ValidationError);
  });

  it('validatePolicyIdParam rejects non-numeric values', () => {
    expect(() => validatePolicyIdParam('abc')).toThrow(ValidationError);
  });
});
