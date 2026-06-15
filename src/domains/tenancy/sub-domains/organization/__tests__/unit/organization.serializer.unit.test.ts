import { describe, expect, it } from 'vitest';
import { serializeOrganization } from '@/domains/tenancy/sub-domains/organization/organization.serializer.js';
import { serializeOrganizationSettings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.serializer.js';
import { serializeOrganizationApiKey } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.serializer.js';
import { serializeOrganizationNotificationPolicy } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

describe('organization serializers', () => {
  it('serializeOrganization maps public_id to id and ISO dates', () => {
    expect(
      serializeOrganization({
        public_id: 'org-public',
        name: 'Demo',
        slug: 'demo-org',
        type: 'TEAM',
        status: 'ACTIVE',
        logo_url: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ).toEqual({
      id: 'org-public',
      name: 'Demo',
      slug: 'demo-org',
      type: 'TEAM',
      status: 'ACTIVE',
      logo_url: null,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('serializeOrganization passes through a null slug for a personal organization', () => {
    expect(
      serializeOrganization({
        public_id: 'org-personal',
        name: 'Personal',
        slug: null,
        type: 'PERSONAL',
        status: 'ACTIVE',
        logo_url: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }).slug,
    ).toBeNull();
  });

  it('serializeOrganizationSettings maps settings row', () => {
    expect(
      serializeOrganizationSettings('org-public', {
        is_email_notifications_enabled: true,
        security_policy: { mfa_required: true },
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ).toEqual({
      organization_id: 'org-public',
      is_email_notifications_enabled: true,
      default_locale: 'en',
      security_policy: { mfa_required: true },
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('serializeOrganizationApiKey maps key row with organization public id', () => {
    const lastUsedAt = new Date('2026-01-03T00:00:00.000Z');
    expect(
      serializeOrganizationApiKey(
        {
          id: 1,
          public_id: 'key-public',
          organization_id: 10,
          name: 'CI',
          key_hash: 'hash',
          key_prefix: 'cb_',
          scopes: ['tenancy:organization:read'],
          last_used_at: lastUsedAt,
          expires_at: null,
          status: 'ACTIVE',
          deleted_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
          created_by_user_id: null,
          updated_by_user_id: null,
        },
        'org-public',
      ),
    ).toMatchObject({
      id: 'key-public',
      organization_id: 'org-public',
      name: 'CI',
      key_prefix: 'cb_',
      last_used_at: lastUsedAt.toISOString(),
      expires_at: null,
      status: 'ACTIVE',
    });
  });

  it('serializeOrganizationNotificationPolicy maps policy row', () => {
    const mutedUntil = new Date('2026-06-01T00:00:00.000Z');
    expect(
      serializeOrganizationNotificationPolicy(
        {
          id: 1,
          public_id: 'policy-public',
          organization_id: 10,
          notification_type: 'billing',
          channel: 'email',
          default_enabled: true,
          is_mandatory: false,
          muted_until: mutedUntil,
          created_at: createdAt,
          updated_at: updatedAt,
        },
        'org-public',
      ),
    ).toMatchObject({
      // sec-T5: serializer now emits the 21-char public id, not the bigserial.
      id: 'policy-public',
      organization_id: 'org-public',
      notification_type: 'billing',
      channel: 'email',
      muted_until: mutedUntil.toISOString(),
    });
  });
});
