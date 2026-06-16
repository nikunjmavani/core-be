import { describe, expect, it } from 'vitest';
import { serializeAuthMeContext } from '@/domains/auth/auth-me-context.serializer.js';
import type { AuthMeContextData } from '@/domains/auth/auth-me-context.types.js';
import type { OrganizationOutput } from '@/domains/tenancy/sub-domains/organization/organization.types.js';

const organization = (id: string, type: 'PERSONAL' | 'TEAM'): OrganizationOutput => ({
  id,
  name: `Org ${id}`,
  slug: type === 'TEAM' ? `org-${id}` : null,
  type,
  status: 'ACTIVE',
  logo_url: null,
  capabilities: {
    can_invite_members: type === 'TEAM',
    can_manage_members: type === 'TEAM',
    can_manage_roles: type === 'TEAM',
    can_transfer_ownership: type === 'TEAM',
    can_delete: type === 'TEAM',
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const baseData = (overrides: Partial<AuthMeContextData> = {}): AuthMeContextData => ({
  user: {
    id: 'usr_1',
    email: 'a@b.com',
    is_email_verified: true,
    is_mfa_enabled: false,
    first_name: 'A',
    last_name: 'B',
    avatar_url: null,
    status: 'ACTIVE',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  activeOrganization: organization('org_active', 'TEAM'),
  activeOrganizationPublicId: 'org_active',
  myPermissions: ['organization:read', 'membership:manage'],
  globalRole: null,
  organizations: [organization('org_active', 'TEAM'), organization('org_other', 'PERSONAL')],
  ...overrides,
});

describe('serializeAuthMeContext', () => {
  it('passes through user, active organization (with capabilities), permissions, and global role', () => {
    const output = serializeAuthMeContext(baseData());
    expect(output.user.id).toBe('usr_1');
    expect(output.active_organization?.id).toBe('org_active');
    expect(output.active_organization?.capabilities.can_invite_members).toBe(true);
    expect(output.my_permissions).toEqual(['organization:read', 'membership:manage']);
    expect(output.global_role).toBeNull();
  });

  it('flags only the active organization with is_active in the switcher list', () => {
    const output = serializeAuthMeContext(baseData());
    expect(output.organizations.find((o) => o.id === 'org_active')?.is_active).toBe(true);
    expect(output.organizations.find((o) => o.id === 'org_other')?.is_active).toBe(false);
  });

  it('marks no organization active when there is no active organization', () => {
    const output = serializeAuthMeContext(
      baseData({ activeOrganization: null, activeOrganizationPublicId: null, myPermissions: [] }),
    );
    expect(output.active_organization).toBeNull();
    expect(output.my_permissions).toEqual([]);
    expect(output.organizations.every((o) => o.is_active === false)).toBe(true);
  });
});
