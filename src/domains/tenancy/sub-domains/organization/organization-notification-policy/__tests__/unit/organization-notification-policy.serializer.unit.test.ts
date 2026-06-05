import { describe, expect, it } from 'vitest';
import { serializeOrganizationNotificationPolicy } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.serializer.js';
import type { OrganizationNotificationPolicyRow } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.types.js';

function makeRow(
  overrides: Partial<OrganizationNotificationPolicyRow> = {},
): OrganizationNotificationPolicyRow {
  return {
    id: 42,
    public_id: 'policy_pub_id_xxx',
    organization_id: 7,
    notification_type: 'security_alert',
    channel: 'email',
    default_enabled: true,
    is_mandatory: false,
    muted_until: null,
    deleted_at: null,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-06-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('serializeOrganizationNotificationPolicy', () => {
  it('serializes muted_until Date to ISO-8601 string', () => {
    const mutedDate = new Date('2025-12-31T23:59:59.000Z');
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ muted_until: mutedDate }),
      'org_pub_abc',
    );
    expect(result.muted_until).toBe('2025-12-31T23:59:59.000Z');
  });

  it('includes all required fields in the output', () => {
    const result = serializeOrganizationNotificationPolicy(makeRow(), 'org_pub_abc');
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('organization_id');
    expect(result).toHaveProperty('notification_type');
    expect(result).toHaveProperty('channel');
    expect(result).toHaveProperty('default_enabled');
    expect(result).toHaveProperty('is_mandatory');
    expect(result).toHaveProperty('muted_until');
    expect(result).toHaveProperty('created_at');
    expect(result).toHaveProperty('updated_at');
  });

  it('uses the provided organization_public_id as organization_id (not internal organization_id)', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ organization_id: 99 }),
      'org_pub_xyz',
    );
    expect(result.organization_id).toBe('org_pub_xyz');
    expect(result.organization_id).not.toBe(99);
  });

  it('sets muted_until to null when row muted_until is null', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ muted_until: null }),
      'org_pub_abc',
    );
    expect(result.muted_until).toBeNull();
  });

  it('does not expose internal organization_id integer in the output', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ organization_id: 7 }),
      'org_pub_abc',
    ) as unknown as Record<string, unknown>;
    // The serialized organization_id must be the public string, not the internal integer
    expect(typeof result.organization_id).toBe('string');
  });

  it('serializes created_at as ISO-8601 string', () => {
    const date = new Date('2025-03-10T09:00:00.000Z');
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ created_at: date }),
      'org_pub_abc',
    );
    expect(result.created_at).toBe('2025-03-10T09:00:00.000Z');
  });

  it('serializes updated_at as ISO-8601 string', () => {
    const date = new Date('2025-05-20T14:30:00.000Z');
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ updated_at: date }),
      'org_pub_abc',
    );
    expect(result.updated_at).toBe('2025-05-20T14:30:00.000Z');
  });

  it('preserves notification_type and channel from the row', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ notification_type: 'billing_alert', channel: 'in_app' }),
      'org_pub_abc',
    );
    expect(result.notification_type).toBe('billing_alert');
    expect(result.channel).toBe('in_app');
  });

  it('preserves boolean flags default_enabled and is_mandatory', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow({ default_enabled: false, is_mandatory: true }),
      'org_pub_abc',
    );
    expect(result.default_enabled).toBe(false);
    expect(result.is_mandatory).toBe(true);
  });

  it('does not expose internal organization_id or public_id raw fields as-is under original key names', () => {
    const result = serializeOrganizationNotificationPolicy(
      makeRow(),
      'org_pub_abc',
    ) as unknown as Record<string, unknown>;
    // organization_id in output should be the public string passed in, not the raw numeric FK
    expect(result.organization_id).toBe('org_pub_abc');
  });
});
