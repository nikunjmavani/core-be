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

  it('route-audit C4: rejects an explicit __proto__ key in security_policy (raw scan before Zod)', () => {
    // A computed-key `['__proto__']` is an OWN property; the validator's raw-key scan rejects it
    // BEFORE Zod (which would otherwise silently drop it and return 200). No pollution either way.
    expect(() =>
      validateUpdateOrganizationSettings({ security_policy: { ['__proto__']: 'x', safe: 'ok' } }),
    ).toThrow(ValidationError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
