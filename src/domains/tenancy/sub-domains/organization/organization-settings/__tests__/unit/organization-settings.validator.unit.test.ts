import { describe, expect, it } from 'vitest';
import { validateUpdateOrganizationSettings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.validator.js';

describe('organization-settings validators', () => {
  it('validateUpdateOrganizationSettings accepts flags', () => {
    expect(validateUpdateOrganizationSettings({ is_email_notifications_enabled: false })).toEqual({
      is_email_notifications_enabled: false,
    });
  });
});
