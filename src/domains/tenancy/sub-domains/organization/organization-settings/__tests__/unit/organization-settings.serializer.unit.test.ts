import { describe, expect, it } from 'vitest';
import { serializeOrganizationSettings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.serializer.js';

function makeSettingsRow(
  overrides: Partial<{
    is_email_notifications_enabled: boolean;
    default_locale: string | null;
    security_policy: unknown;
    created_at: Date;
    updated_at: Date;
  }> = {},
) {
  return {
    is_email_notifications_enabled: true,
    default_locale: 'en' as string | null,
    security_policy: {} as unknown,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-06-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('serializeOrganizationSettings', () => {
  it('returns locale "es" when default_locale is "es"', () => {
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ default_locale: 'es' }),
    );
    expect(result.default_locale).toBe('es');
  });

  it('includes a non-empty security_policy in the output', () => {
    const policy = { require_mfa: true, ip_allowlist: ['10.0.0.1'] };
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ security_policy: policy }),
    );
    expect(result.security_policy).toEqual(policy);
  });

  it('includes all required output fields', () => {
    const result = serializeOrganizationSettings('org_abc123', makeSettingsRow());
    expect(result).toHaveProperty('organization_id');
    expect(result).toHaveProperty('is_email_notifications_enabled');
    expect(result).toHaveProperty('default_locale');
    expect(result).toHaveProperty('security_policy');
    expect(result).toHaveProperty('created_at');
    expect(result).toHaveProperty('updated_at');
  });

  it('uses the provided organization_public_id as organization_id', () => {
    const result = serializeOrganizationSettings('org_xyz999', makeSettingsRow());
    expect(result.organization_id).toBe('org_xyz999');
  });

  it('normalizes unsupported locale "fr" to "en"', () => {
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ default_locale: 'fr' }),
    );
    expect(result.default_locale).toBe('en');
  });

  it('normalizes null default_locale to "en"', () => {
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ default_locale: null }),
    );
    expect(result.default_locale).toBe('en');
  });

  it('normalizes absent default_locale to "en"', () => {
    // Build a row without the optional default_locale key entirely
    const rowWithoutLocale = {
      is_email_notifications_enabled: true,
      security_policy: {} as unknown,
      created_at: new Date('2025-01-01T00:00:00.000Z'),
      updated_at: new Date('2025-06-01T12:00:00.000Z'),
    };
    const result = serializeOrganizationSettings('org_abc123', rowWithoutLocale);
    expect(result.default_locale).toBe('en');
  });

  it('defaults null security_policy to empty object', () => {
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ security_policy: null }),
    );
    expect(result.security_policy).toEqual({});
  });

  it('defaults null security_policy to empty object even when set via makeSettingsRow null', () => {
    // The serializer uses `?? {}` which handles both null and undefined at runtime
    const result = serializeOrganizationSettings('org_abc123', {
      is_email_notifications_enabled: true,
      security_policy: null as unknown,
      default_locale: 'en',
      created_at: new Date('2025-01-01T00:00:00.000Z'),
      updated_at: new Date('2025-06-01T12:00:00.000Z'),
    });
    expect(result.security_policy).toEqual({});
  });

  it('serializes created_at as an ISO 8601 string', () => {
    const date = new Date('2025-03-15T10:30:00.000Z');
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ created_at: date }),
    );
    expect(result.created_at).toBe('2025-03-15T10:30:00.000Z');
  });

  it('serializes updated_at as an ISO 8601 string', () => {
    const date = new Date('2025-04-20T08:00:00.000Z');
    const result = serializeOrganizationSettings(
      'org_abc123',
      makeSettingsRow({ updated_at: date }),
    );
    expect(result.updated_at).toBe('2025-04-20T08:00:00.000Z');
  });
});
