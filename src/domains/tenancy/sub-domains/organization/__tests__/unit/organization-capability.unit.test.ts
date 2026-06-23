import { describe, expect, it } from 'vitest';
import {
  assertTeamOrganization,
  organizationCapabilities,
  type OrganizationCapability,
} from '@/domains/tenancy/sub-domains/organization/organization-capability.js';
import { UnprocessableEntityError } from '@/shared/errors/index.js';

describe('organizationCapabilities', () => {
  it('returns all-true flags for a TEAM organization', () => {
    expect(organizationCapabilities('TEAM')).toEqual({
      can_invite_members: true,
      can_manage_members: true,
      can_manage_roles: true,
      can_transfer_ownership: true,
      can_delete: true,
      can_manage_billing: true,
    });
  });

  it('returns all-false flags for a PERSONAL organization', () => {
    expect(organizationCapabilities('PERSONAL')).toEqual({
      can_invite_members: false,
      can_manage_members: false,
      can_manage_roles: false,
      can_transfer_ownership: false,
      can_delete: false,
      can_manage_billing: false,
    });
  });
});

describe('assertTeamOrganization', () => {
  it('is a no-op for a TEAM organization across every capability', () => {
    expect(() => assertTeamOrganization({ type: 'TEAM' }, 'MEMBERS')).not.toThrow();
    expect(() => assertTeamOrganization({ type: 'TEAM' }, 'ROLES')).not.toThrow();
    expect(() => assertTeamOrganization({ type: 'TEAM' }, 'MUTATION')).not.toThrow();
    expect(() => assertTeamOrganization({ type: 'TEAM' }, 'BILLING')).not.toThrow();
  });

  it.each<[OrganizationCapability, string]>([
    ['MEMBERS', 'errors:personalOrganizationNoMembers'],
    ['ROLES', 'errors:personalOrganizationNoRoles'],
    ['MUTATION', 'errors:personalOrganizationImmutable'],
    ['BILLING', 'errors:personalOrganizationNoBilling'],
  ])('rejects %s on a PERSONAL organization with 422 and key %s', (capability, messageKey) => {
    let caught: unknown;
    try {
      assertTeamOrganization({ type: 'PERSONAL' }, capability);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnprocessableEntityError);
    expect(caught).toMatchObject({
      statusCode: 422,
      code: 'UNPROCESSABLE_ENTITY',
      messageKey,
    });
  });
});
