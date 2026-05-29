import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidatePermissions: vi.fn().mockResolvedValue(undefined),
  invalidateOrganizationPermissions: vi.fn().mockResolvedValue(undefined),
}));
import { ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { MembershipService } from '@/domains/tenancy/sub-domains/membership/membership.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { MemberRoleService } from '@/domains/tenancy/sub-domains/member-roles/member-role.service.js';
import type { MemberRolePermissionService } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.service.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

const organization = { id: 1, public_id: 'org_public', owner_user_id: 99 };
const role = { id: 2, public_id: 'role_public', name: 'Admin' };
const membershipRow = {
  id: 3,
  public_id: 'mem_public',
  organization_id: 1,
  user_id: 10,
  role_id: 2,
  status: 'ACTIVE',
  joined_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
};

describe('MembershipService', () => {
  const organizationService = {
    requireOrganizationMembershipByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserInternalIdByPublicId: vi.fn().mockResolvedValue(10),
    resolveUserPublicIdByInternalId: vi.fn().mockResolvedValue('user_public'),
  } as unknown as OrganizationService;

  const memberRoleService = {
    requireRoleRecordByPublicId: vi.fn().mockResolvedValue(role),
    requireRoleRecordForOrganization: vi.fn().mockResolvedValue(role),
    resolveRolePublicIdByInternalId: vi.fn().mockResolvedValue('role_public'),
    resolveRolePublicIdForOrganization: vi.fn().mockResolvedValue('role_public'),
  } as unknown as MemberRoleService;

  const memberRolePermissionService = {
    listPermissionCodesForRole: vi.fn().mockResolvedValue(['organization:read']),
  } as unknown as MemberRolePermissionService;

  const membershipRepository = {
    findByOrganizationId: vi.fn().mockResolvedValue({
      items: [membershipRow],
      total: null,
      limit: 20,
      has_more: false,
      next_cursor: null,
    }),
    findByPublicId: vi.fn().mockResolvedValue(membershipRow),
    create: vi.fn().mockResolvedValue(membershipRow),
    update: vi.fn().mockResolvedValue(membershipRow),
    softDelete: vi.fn().mockResolvedValue(membershipRow),
    findByUserAndOrganization: vi.fn().mockResolvedValue(membershipRow),
  } as unknown as MembershipRepository;

  const service = new MembershipService(
    organizationService,
    memberRoleService,
    memberRolePermissionService,
    membershipRepository,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(memberRoleService.resolveRolePublicIdForOrganization).mockResolvedValue(
      'role_public',
    );
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue(
      organization as never,
    );
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockReset();
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(10);
    vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(membershipRow as never);
    vi.mocked(membershipRepository.findByUserAndOrganization).mockResolvedValue(
      membershipRow as never,
    );
    vi.mocked(membershipRepository.update).mockResolvedValue(membershipRow as never);
    vi.mocked(membershipRepository.softDelete).mockResolvedValue(membershipRow as never);
  });

  it('list returns paginated memberships', async () => {
    const result = await service.list('org_public', { limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBeNull();
    expect(membershipRepository.findByOrganizationId).toHaveBeenCalledWith(1, {
      limit: 20,
    });
  });

  it('getByPublicId returns membership', async () => {
    const result = await service.getByPublicId('org_public', 'mem_public');
    expect(result.id).toBe('mem_public');
  });

  it('getByPublicId throws when missing', async () => {
    vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(null);
    await expect(service.getByPublicId('org_public', 'missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('create adds membership for user', async () => {
    const result = await service.create(
      'org_public',
      { user_id: 'user_public', role_id: 'role_public', status: 'ACTIVE' },
      'inviter_public',
    );
    expect(memberRoleService.requireRoleRecordByPublicId).toHaveBeenCalledWith(
      'org_public',
      'role_public',
    );
    expect(membershipRepository.create).toHaveBeenCalled();
    expect(invalidatePermissions).toHaveBeenCalledWith('user_public', 'org_public');
    expect(result.id).toBe('mem_public');
  });

  it('getPermissions throws when organization context is missing', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockRejectedValueOnce(
      new NotFoundError('Organization'),
    );
    await expect(service.getPermissions('missing', 'mem_public')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('getPermissions returns role permission codes', async () => {
    const result = await service.getPermissions('org_public', 'mem_public');
    expect(result.permissions).toEqual(['organization:read']);
  });

  it('update changes membership status', async () => {
    await service.update('org_public', 'mem_public', { status: 'SUSPENDED' }, 'updater_public');
    expect(membershipRepository.update).toHaveBeenCalled();
  });

  it('delete soft-deletes membership', async () => {
    await service.delete('org_public', 'mem_public');
    expect(membershipRepository.softDelete).toHaveBeenCalled();
  });

  it('leaveOrganization throws when user id cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await expect(service.leaveOrganization('org_public', 'missing_user')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('update throws when membership is missing', async () => {
    vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(null);
    await expect(
      service.update('org_public', 'missing', { status: 'ACTIVE' }, 'updater_public'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('leaveOrganization forbids organization owner', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(99);
    await expect(service.leaveOrganization('org_public', 'owner_public')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('leaveOrganization soft-deletes non-owner membership', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(10);
    await service.leaveOrganization('org_public', 'member_public');
    expect(membershipRepository.softDelete).toHaveBeenCalled();
  });

  it('transferOwnership requires current owner and updates organization owner', async () => {
    const transferOrganizationOwnership = vi.fn().mockResolvedValue(undefined);
    const organizationServiceWithTransfer = {
      ...organizationService,
      requireOrganizationMembershipByPublicId: vi.fn().mockResolvedValue({
        ...organization,
        owner_user_id: 99,
      }),
      resolveUserInternalIdByPublicId: vi.fn().mockImplementation(async (publicId: string) => {
        if (publicId === 'owner_public') return 99;
        if (publicId === 'new_owner_public') return 10;
        return null;
      }),
      transferOrganizationOwnership,
    } as unknown as OrganizationService;

    const transferService = new MembershipService(
      organizationServiceWithTransfer,
      memberRoleService,
      memberRolePermissionService,
      membershipRepository,
    );

    await transferService.transferOwnership(
      'org_public',
      { new_owner_user_id: 'new_owner_public' },
      'owner_public',
    );
    expect(transferOrganizationOwnership).toHaveBeenCalled();
  });

  it('transferOwnership rejects non-owner caller', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(10);
    await expect(
      service.transferOwnership(
        'org_public',
        { new_owner_user_id: 'other_public' },
        'not_owner_public',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('update passes null updater when user id cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockImplementation(
      async (publicId: string) => (publicId === 'missing_updater' ? null : 10),
    );
    await service.update('org_public', 'mem_public', { status: 'SUSPENDED' }, 'missing_updater');
    expect(membershipRepository.update).toHaveBeenCalledWith(
      'mem_public',
      organization.id,
      { status: 'SUSPENDED' },
      null,
    );
  });

  it('update throws when repository update returns null', async () => {
    vi.mocked(membershipRepository.update).mockResolvedValue(null);
    await expect(
      service.update('org_public', 'mem_public', { status: 'ACTIVE' }, 'updater_public'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete throws when soft delete returns null', async () => {
    vi.mocked(membershipRepository.softDelete).mockResolvedValue(null);
    await expect(service.delete('org_public', 'mem_public')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('leaveOrganization throws when membership is missing', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(10);
    vi.mocked(membershipRepository.findByUserAndOrganization).mockResolvedValue(null);
    await expect(service.leaveOrganization('org_public', 'member_public')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('create throws when user public id cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await expect(
      service.create(
        'org_public',
        { user_id: 'missing_user', role_id: 'role_public', status: 'ACTIVE' },
        'inviter_public',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('leaveOrganization throws when soft delete returns null', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(10);
    vi.mocked(membershipRepository.softDelete).mockResolvedValue(null);
    await expect(service.leaveOrganization('org_public', 'member_public')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('getPermissions throws when membership is missing', async () => {
    vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(null);
    await expect(service.getPermissions('org_public', 'missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('delete throws when soft delete returns null', async () => {
    vi.mocked(membershipRepository.softDelete).mockResolvedValue(null);
    await expect(service.delete('org_public', 'mem_public')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('transferOwnership throws when current user cannot be resolved', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue({
      ...organization,
      owner_user_id: 99,
    } as never);
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await expect(
      service.transferOwnership(
        'org_public',
        { new_owner_user_id: 'new_owner_public' },
        'owner_public',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('transferOwnership throws when new owner user cannot be resolved', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue({
      ...organization,
      owner_user_id: 99,
    } as never);
    vi.mocked(organizationService.resolveUserInternalIdByPublicId)
      .mockResolvedValueOnce(99)
      .mockResolvedValueOnce(null);
    await expect(
      service.transferOwnership(
        'org_public',
        { new_owner_user_id: 'missing_user' },
        'owner_public',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create allows null inviter when inviter public id cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockImplementation(
      async (publicId: string) => {
        if (publicId === 'user_public') return 10;
        if (publicId === 'missing_inviter') return null;
        return 10;
      },
    );
    await service.create(
      'org_public',
      { user_id: 'user_public', role_id: 'role_public', status: 'ACTIVE' },
      'missing_inviter',
    );
    expect(membershipRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ invited_by_user_id: null, created_by_user_id: null }),
    );
  });

  it('transferOwnership requires new owner membership', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue({
      ...organization,
      owner_user_id: 99,
    } as never);
    vi.mocked(organizationService.resolveUserInternalIdByPublicId)
      .mockResolvedValueOnce(99)
      .mockResolvedValueOnce(10);
    vi.mocked(membershipRepository.findByUserAndOrganization).mockResolvedValue(null);
    await expect(
      service.transferOwnership(
        'org_public',
        { new_owner_user_id: 'new_owner_public' },
        'owner_public',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
