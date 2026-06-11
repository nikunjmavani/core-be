import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateUpdateOrganizationSettings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.validator.js';

describe('organization-settings validators', () => {
  it('validateUpdateOrganizationSettings accepts flags', () => {
    expect(validateUpdateOrganizationSettings({ is_email_notifications_enabled: false })).toEqual({
      is_email_notifications_enabled: false,
    });
  });

  it('accepts a normal security_policy record', () => {
    const result = validateUpdateOrganizationSettings({
      security_policy: { require_mfa: true, max_sessions: 5 },
    });
    expect(result.security_policy).toEqual({ require_mfa: true, max_sessions: 5 });
  });

  it('route-audit hardening: rejects constructor / prototype keys in security_policy', () => {
    for (const key of ['constructor', 'prototype']) {
      expect(() => validateUpdateOrganizationSettings({ security_policy: { [key]: 'x' } })).toThrow(
        ValidationError,
      );
    }
  });

  it('route-audit hardening: a __proto__ key cannot pollute or survive into the parsed policy', () => {
    const result = validateUpdateOrganizationSettings({
      security_policy: { ['__proto__']: 'x', safe: 'ok' },
    });
    // The __proto__ key is neutralized by the record reconstruction — never stored, no pollution.
    expect(Object.keys(result.security_policy ?? {})).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
