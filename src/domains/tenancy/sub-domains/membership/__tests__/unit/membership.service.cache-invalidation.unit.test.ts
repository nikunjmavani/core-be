import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { MembershipService } from '@/domains/tenancy/sub-domains/membership/membership.service.js';

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidatePermissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js', () => ({
  assertCallerCanGrantPermissionCodes: vi.fn().mockResolvedValue(undefined),
}));

import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

describe('MembershipService — permission cache invalidation', () => {
  const organizationService = {
    requireOrganizationMembershipByPublicId: vi.fn().mockResolvedValue({
      id: 1,
      public_id: 'org_public_abc',
      owner_user_id: 10,
    }),
    resolveUserInternalIdByPublicId: vi.fn().mockResolvedValue(5),
    resolveUserPublicIdByInternalId: vi.fn().mockResolvedValue('user_public_affected'),
    transferOrganizationOwnership: vi.fn().mockResolvedValue(undefined),
  };

  const memberRoleService = {
    requireRoleRecordByPublicId: vi.fn().mockResolvedValue({ id: 2, public_id: 'role_public' }),
  };

  const memberRolePermissionService = {
    listPermissionCodesForRole: vi.fn().mockResolvedValue(['tenancy:read']),
  };

  const membershipRepository = {
    create: vi.fn().mockResolvedValue({
      public_id: 'membership_public',
      user_id: 5,
      role_id: 2,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    }),
    findByPublicId: vi.fn().mockResolvedValue({
      public_id: 'membership_public',
      user_id: 5,
      role_id: 2,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    }),
    update: vi.fn().mockResolvedValue({
      public_id: 'membership_public',
      user_id: 5,
      role_id: 3,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    }),
    softDelete: vi.fn().mockResolvedValue({ public_id: 'membership_public' }),
    resolveUserSummariesByInternalIds: vi.fn(
      async (ids: readonly number[]) =>
        new Map(
          ids.map((id) => [
            id,
            {
              public_id: `user_public_${id}`,
              email: `user${id}@example.com`,
              first_name: 'Test',
              last_name: `User${id}`,
              avatar_url: null,
            },
          ]),
        ),
    ),
    resolveRoleSummariesByInternalIds: vi.fn(
      async (ids: readonly number[]) =>
        new Map(ids.map((id) => [id, { public_id: `role_public_${id}`, name: 'Admin' }])),
    ),
    resolveLiveInvitationsByMembershipIds: vi.fn(async () => new Map()),
    findByUserAndOrganization: vi.fn().mockResolvedValue({
      public_id: 'membership_public',
      user_id: 20,
      role_id: 2,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    }),
  };

  const authorizationService = {
    resolveUserOrganizationPermissions: vi.fn().mockResolvedValue([]),
  };
  const permissionRepository = {
    findAll: vi.fn().mockResolvedValue([]),
  };

  const service = new MembershipService(
    organizationService as never,
    memberRoleService as never,
    memberRolePermissionService as never,
    membershipRepository as never,
    authorizationService as never,
    permissionRepository as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create invalidates user permission cache after membership is created', async () => {
    await service.create(
      'org_public_abc',
      { user_id: 'user_public_new', role_id: 'role_public', status: 'INVITED' },
      'inviter_public',
    );

    expect(invalidatePermissions).toHaveBeenCalledWith('user_public_new', 'org_public_abc');
  });

  it('update invalidates the affected user permission cache', async () => {
    await service.update('org_public_abc', 'membership_public', { status: 'SUSPENDED' }, 'admin');

    expect(organizationService.resolveUserPublicIdByInternalId).toHaveBeenCalledWith(5);
    expect(invalidatePermissions).toHaveBeenCalledWith('user_public_affected', 'org_public_abc');
  });

  it('delete invalidates the affected user permission cache', async () => {
    membershipRepository.softDelete.mockResolvedValueOnce({
      public_id: 'membership_public',
      user_id: 5,
    });

    await service.delete('org_public_abc', 'membership_public');

    expect(organizationService.resolveUserPublicIdByInternalId).toHaveBeenCalledWith(5);
    expect(invalidatePermissions).toHaveBeenCalledWith('user_public_affected', 'org_public_abc');
  });

  it('leaveOrganization invalidates the leaving user permission cache', async () => {
    await service.leaveOrganization('org_public_abc', 'user_public_leaver');

    expect(invalidatePermissions).toHaveBeenCalledWith('user_public_leaver', 'org_public_abc');
  });
});
